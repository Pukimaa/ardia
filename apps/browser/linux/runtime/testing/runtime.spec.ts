import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type StubWindow = Window & {
  expo: { modules: Record<string, Record<string, unknown> | undefined>; getViewConfig(name: string): unknown };
  __ardiaStub: { calls: { module: string; method: string; sync: boolean }[]; emit(module: string, event: string, payload: unknown): void };
  __ardiaWindowDocuments(): string[];
  __ardiaNativeOpenWindowDocument(windowId: string): boolean;
};

const trackErrors = (context: BrowserContext) => {
  const errors: string[] = [];
  const watch = (page: Page) => page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.stack ?? error.message}`));
  context.pages().forEach(watch);
  context.on("page", watch);
  return errors;
};

const bootHost = async (page: Page, context: BrowserContext) => {
  const firstWindow = context.waitForEvent("page");
  await page.goto("testing.html");
  const popup = await firstWindow;
  await popup.waitForLoadState();
  return popup;
};

test("the host page opens the first window as a same-origin popup and renders main into it", async ({ page, context }) => {
  const errors = trackErrors(context);
  const popup = await bootHost(page, context);
  expect(popup.url()).toMatch(/\/window\.html#w-/);
  const windowId = decodeURIComponent(new URL(popup.url()).hash.slice(1));
  expect(await popup.evaluate(() => window.name)).toBe(`ardia-window-${windowId}`);
  await expect(popup.getByText("Your new home on the internet")).toBeVisible();
  expect(await popup.evaluate(() => document.getElementById("react-native-stylesheet")?.textContent?.length ?? 0)).toBeGreaterThan(1000);
  expect(await page.evaluate(() => (window as unknown as StubWindow).__ardiaWindowDocuments())).toEqual([windowId]);
  expect(await page.evaluate(() => document.body.childElementCount)).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test("presses in a window document reach the app", async ({ page, context }) => {
  const errors = trackErrors(context);
  const popup = await bootHost(page, context);
  const tagline = popup.getByText("Your new home on the internet");
  await expect(tagline).toBeVisible();
  await popup.getByText("Skip", { exact: true }).click();
  await expect(tagline).toBeHidden({ timeout: 10000 });
  expect(errors).toEqual([]);
});

test("each window document mounts on open and unmounts when it closes", async ({ page, context }) => {
  const errors = trackErrors(context);
  const first = await bootHost(page, context);
  const firstId = decodeURIComponent(new URL(first.url()).hash.slice(1));
  const second = context.waitForEvent("page");
  expect(await page.evaluate(() => (window as unknown as StubWindow).__ardiaNativeOpenWindowDocument("w-second"))).toBe(true);
  const popup = await second;
  await popup.waitForLoadState();
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__ardiaWindowDocuments().sort())).toEqual([firstId, "w-second"].sort());
  expect(await page.evaluate(() => (window as unknown as StubWindow).__ardiaNativeOpenWindowDocument("w-second"))).toBe(true);
  expect(context.pages()).toHaveLength(3);
  await popup.close();
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__ardiaWindowDocuments())).toEqual([firstId]);
  await expect(first.getByText("Your new home on the internet")).toBeVisible();
  expect(errors).toEqual([]);
});

test("native modules follow the spec's sync and async split, constants and events", async ({ page, context }) => {
  await bootHost(page, context);
  const result = await page.evaluate(async () => {
    const win = window as unknown as StubWindow;
    const { modules } = win.expo;
    const app = modules.ArdiaApp!;
    const shell = modules.ArdiaShell!;
    const info = (app.systemInfo as () => unknown)();
    const ids = (shell.windowIds as () => unknown)();
    const received: unknown[] = [];
    const subscription = (shell.addListener as (event: string, listener: (payload: unknown) => void) => { remove(): void })("onWindowEvent", (payload) =>
      received.push(payload),
    );
    win.__ardiaStub.emit("ArdiaShell", "onWindowEvent", { type: "focus" });
    subscription.remove();
    win.__ardiaStub.emit("ArdiaShell", "onWindowEvent", { type: "blur" });
    const calls = win.__ardiaStub.calls.filter((call) => call.method === "systemInfo" || call.method === "windowIds");
    return {
      apiVersion: app.apiVersion,
      infoIsPromise: info instanceof Promise,
      idsIsPromise: ids instanceof Promise,
      ids: await ids,
      missing: modules.ArdiaNoSuchModule ?? null,
      unknownMethod: typeof shell.noSuchMethod,
      received,
      systemInfoSync: calls.filter((call) => call.method === "systemInfo").every((call) => call.sync),
      windowIdsAsync: calls.filter((call) => call.method === "windowIds").every((call) => !call.sync),
      symbolConfig: win.expo.getViewConfig("ArdiaSymbol") != null,
    };
  });
  expect(result).toEqual({
    apiVersion: 12,
    infoIsPromise: false,
    idsIsPromise: true,
    ids: [],
    missing: null,
    unknownMethod: "undefined",
    received: [{ type: "focus" }],
    systemInfoSync: true,
    windowIdsAsync: true,
    symbolConfig: true,
  });
});

test("animation frames follow the visible window and keep the host's clock", async ({ page, context }) => {
  await bootHost(page, context);
  const frame = await page.evaluate(
    () =>
      new Promise<{ delta: number }>((resolve) => {
        requestAnimationFrame((time) => resolve({ delta: Math.abs(performance.now() - time) }));
      }),
  );
  expect(frame.delta).toBeLessThan(1000);
  const cancelled = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        let ran = false;
        const id = requestAnimationFrame(() => (ran = true));
        cancelAnimationFrame(id);
        setTimeout(() => resolve(!ran), 100);
      }),
  );
  expect(cancelled).toBe(true);
});

test("macOS view props, keys, responders and layout work inside a window document", async ({ page, context }) => {
  const errors = trackErrors(context);
  await bootHost(page, context);
  const opened = context.waitForEvent("page");
  await page.evaluate(() => void window.open("window.html#probe", "ardia-probe"));
  const popup = await opened;
  await popup.waitForLoadState();
  await page.evaluate(() => {
    const probe = window.open("", "ardia-probe")!;
    (window as Window & { probeLog?: unknown }).probeLog = window.__ardiaCompatProbe!(probe);
  });
  const log = () => page.evaluate(() => (window as Window & { probeLog?: { events: string[]; layout: { width: number } | null; tag: number | null } }).probeLog!);
  const take = async () => {
    const events = (await log()).events.splice(0);
    await page.evaluate((count) => (window as Window & { probeLog?: { events: string[] } }).probeLog!.events.splice(0, count), events.length);
    return events;
  };

  const keys = popup.getByTestId("keys");
  await expect(keys).toHaveAttribute("title", "Probe tooltip");
  expect(typeof (await log()).tag).toBe("number");
  await expect.poll(async () => (await log()).layout?.width ?? 0).toBeGreaterThan(100);
  const before = (await log()).layout!.width;
  await popup.setViewportSize({ width: 700, height: 500 });
  await expect.poll(async () => (await log()).layout?.width).not.toBe(before);

  await keys.focus();
  await popup.keyboard.press("Escape");
  await popup.keyboard.press("a");
  await popup.keyboard.press("Enter");
  await popup.keyboard.press("Shift+Enter");
  await expect.poll(take).toEqual(["view:Escape:true", "view:Enter:true"]);

  const field = popup.getByTestId("field");
  await field.click();
  await popup.keyboard.type("hi");
  await popup.keyboard.press("ArrowDown");
  await popup.keyboard.press("Meta+Enter");
  await popup.keyboard.press("Enter");
  await expect.poll(take).toEqual(["input:ArrowDown", "input:Enter", "input:submit"]);
  await expect(field).toHaveValue("hi");

  const pan = await popup.getByTestId("pan").boundingBox();
  await popup.mouse.move(pan!.x + 10, pan!.y + 10);
  await popup.mouse.down();
  await popup.mouse.move(pan!.x + 60, pan!.y + 10, { steps: 3 });
  await popup.mouse.up();
  const panEvents = await take();
  expect(panEvents[0]).toBe("pan:grant");
  expect(panEvents).toContain("pan:move:50");
  expect(panEvents.at(-1)).toBe("pan:release");

  await popup.getByTestId("press").click();
  await expect.poll(take).toEqual(["press"]);
  await popup.getByTestId("press").dblclick();
  await expect.poll(take).toContain("doubleClick");
  expect(errors).toEqual([]);
});
