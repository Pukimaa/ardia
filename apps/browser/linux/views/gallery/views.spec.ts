import { expect, test, type Page } from "@playwright/test";

type Rect = { x: number; y: number; width: number; height: number };
type Call = { kind: string; manager?: string; viewId?: number; props?: Record<string, unknown>; update?: { frame?: Rect; clip?: Rect; visible?: boolean; order?: number; props?: Record<string, unknown> }; method?: string; args?: unknown[]; at: number };

const shots = `${process.cwd().replace(/\/linux\/views$/, "")}/build-linux/gallery`;
const join = (...parts: string[]) => parts.join("/");

const open = async (page: Page, scheme: "light" | "dark" = "light") => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("gallery.html");
  await page.waitForFunction(() => !!document.querySelector('[data-section="cef"]'));
  return errors;
};

const calls = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__ardiaFakeNative!.calls)) as Call[]);
const nextFrames = (page: Page, n = 2) =>
  page.evaluate((count) => new Promise<void>((done) => {
    let left = count;
    const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);

const rectOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);

const close = (a: Rect, b: Rect) => {
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(a[key] - b[key])).toBeLessThan(0.01);
};

const cefId = async (page: Page) => (await calls(page)).filter((c) => c.kind === "createView" && c.manager === "ArdiaCEF").at(-1)!.viewId!;
const lastPlacement = async (page: Page, viewId: number) => (await calls(page)).filter((c) => c.kind === "updateView" && c.viewId === viewId && c.update?.frame).at(-1)!.update!;

test("every view manager renders and the gallery screenshots are written", async ({ page }) => {
  const errors = await open(page);
  await page.waitForTimeout(400);
  await page.locator('[data-section="power-up"]').screenshot({ path: join(shots, "power-up-0.4s.png") });
  await page.waitForTimeout(600);
  for (const name of ["symbols", "symbols-dark", "symbol-weights", "labels", "surfaces", "materials", "docks", "backdrops", "swatches", "behaviours", "cef"]) {
    await page.locator(`[data-section="${name}"]`).screenshot({ path: join(shots, `${name}.png`) });
  }
  await page.screenshot({ path: join(shots, "gallery-light.png"), fullPage: true });
  expect(errors).toEqual([]);
  const counts = await page.evaluate(() => ({
    symbols: document.querySelectorAll('[data-section="symbols"] svg[data-symbol]').length,
    spinners: document.querySelectorAll("svg[data-ardia-spinner]").length,
    fadeMasked: getComputedStyle(document.querySelector('[data-fade="overflow"] div div') ?? document.body).maskImage,
  }));
  expect(counts.symbols).toBe(299);
  expect(counts.spinners).toBe(3);
  expect(counts.fadeMasked).toContain("linear-gradient");
});

test("the shaders draw: backdrop gradient, theme swatch and the power-up band", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(300);
  const sample = await page.evaluate(() => {
    const read = (canvas: HTMLCanvasElement) => {
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) lit++;
      const top = [...ctx.getImageData(copy.width / 2, 2, 1, 1).data];
      const bottom = [...ctx.getImageData(copy.width / 2, copy.height - 3, 1, 1).data];
      return { lit: lit / (copy.width * copy.height), top, bottom, width: canvas.width };
    };
    const backdrop = document.querySelector('[data-backdrop="gradient"] canvas') as HTMLCanvasElement;
    const swatch = document.querySelector("[data-theme-swatch] canvas") as HTMLCanvasElement;
    const power = document.querySelector("[data-power-up] canvas") as HTMLCanvasElement;
    return { backdrop: read(backdrop), swatch: read(swatch), power: read(power) };
  });
  const haloPeak = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        window.__gallery!.replayPowerUp();
        const started = performance.now();
        let peak = 0;
        const sample = () => {
          const canvas = document.querySelector("[data-power-up-halo] canvas") as HTMLCanvasElement | null;
          if (canvas && canvas.width > 1) {
            const copy = document.createElement("canvas");
            copy.width = canvas.width;
            copy.height = canvas.height;
            const ctx = copy.getContext("2d")!;
            ctx.drawImage(canvas, 0, 0);
            const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
            let lit = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) lit++;
            peak = Math.max(peak, lit / (copy.width * copy.height));
          }
          if (performance.now() - started < 1500) requestAnimationFrame(sample);
          else done(peak);
        };
        requestAnimationFrame(sample);
      }),
  );
  expect(sample.backdrop.lit).toBeGreaterThan(0.99);
  expect(sample.backdrop.width).toBe(320);
  expect(sample.backdrop.top).not.toEqual(sample.backdrop.bottom);
  expect(sample.swatch.lit).toBeGreaterThan(0.99);
  expect(sample.power.lit).toBeGreaterThan(0.01);
  expect(haloPeak).toBeGreaterThan(0.01);
});

test("dark appearance screenshots", async ({ page }) => {
  const errors = await open(page, "dark");
  await page.waitForTimeout(500);
  for (const name of ["labels", "materials", "backdrops"]) await page.locator(`[data-section="${name}"]`).screenshot({ path: join(shots, `${name}-dark.png`) });
  expect(errors).toEqual([]);
});

test("ArdiaCEF reports its frame and clip in window coordinates, once per frame, and only on change", async ({ page }) => {
  await open(page);
  await page.locator('[data-section="cef"]').scrollIntoViewIfNeeded();
  await nextFrames(page, 3);
  const id = await cefId(page);
  const created = (await calls(page)).find((c) => c.kind === "createView" && c.viewId === id)!;
  expect(created.props).toMatchObject({ url: "https://example.com/", profile: "default", visible: true });
  expect(Object.values(created.props!).some((v) => typeof v === "function")).toBe(false);

  const selector = '[data-ardia-native-view="ArdiaCEF"]';
  const scroller = '[data-cef-scroller]';
  const check = async () => {
    const placement = await lastPlacement(page, id);
    const frame = await rectOf(page, selector);
    const box = await page.evaluate((s) => {
      const node = document.querySelector(s) as HTMLElement;
      const r = node.getBoundingClientRect();
      const x = Math.max(0, r.x + node.clientLeft);
      const y = Math.max(0, r.y + node.clientTop);
      const right = Math.min(innerWidth, r.x + node.clientLeft + node.clientWidth);
      const bottom = Math.min(innerHeight, r.y + node.clientTop + node.clientHeight);
      return { x, y, width: right - x, height: bottom - y };
    }, scroller);
    close(placement.frame!, frame);
    const x0 = Math.max(frame.x, box.x);
    const y0 = Math.max(frame.y, box.y);
    const x1 = Math.min(frame.x + frame.width, box.x + box.width);
    const y1 = Math.min(frame.y + frame.height, box.y + box.height);
    close(placement.clip!, { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) });
    expect(placement.visible).toBe(true);
    return placement;
  };
  const initial = await check();
  expect(initial.clip!.width).toBeLessThan(initial.frame!.width);

  await page.evaluate(() => window.__ardiaFakeNative!.reset());
  await page.waitForTimeout(300);
  expect((await calls(page)).filter((c) => c.kind === "updateView")).toEqual([]);

  await page.evaluate(() => {
    const node = document.querySelector("[data-cef-scroller]") as HTMLElement;
    for (const top of [10, 40, 80, 120, 150]) node.scrollTop = top;
  });
  await nextFrames(page, 3);
  const scrolled = (await calls(page)).filter((c) => c.kind === "updateView" && c.viewId === id);
  expect(scrolled.length).toBe(1);
  const scrolledPlacement = await check();
  expect(scrolledPlacement.frame!.y).toBeLessThan(initial.frame!.y);

  await page.evaluate(() => window.__gallery!.cef.set({ shift: 37 }));
  await nextFrames(page, 3);
  const shifted = await check();
  expect(shifted.frame!.x - scrolledPlacement.frame!.x).toBeCloseTo(37, 2);

  const frames = (await calls(page)).filter((c) => c.kind === "updateView" && c.viewId === id && c.update?.frame).map((c) => c.at);
  expect(new Set(frames).size).toBe(frames.length);

  await page.evaluate(() => window.__gallery!.cef.set({ clipped: false }));
  await nextFrames(page, 3);
  const unclipped = await lastPlacement(page, id);
  expect(unclipped.clip!.height).toBeGreaterThan(scrolledPlacement.clip!.height);

  await page.evaluate(() => window.__gallery!.cef.set({ url: "https://ardia.dev/" }));
  await nextFrames(page, 2);
  const propsUpdate = (await calls(page)).filter((c) => c.kind === "updateView" && c.viewId === id && c.update?.props).at(-1)!;
  expect(propsUpdate.update!.props).toEqual({ url: "https://ardia.dev/" });
});

test("ArdiaCEF events reach the WebView's handlers and its methods go through callView", async ({ page }) => {
  await open(page);
  await nextFrames(page, 2);
  const id = await cefId(page);
  await page.evaluate((viewId) => {
    const fake = window.__ardiaFakeNative!;
    fake.emitView(viewId, "onProgress", { progress: 0.5 });
    fake.emitView(viewId, "onReady", { browserId: 7, tabId: 3 });
    fake.emitView(viewId, "onNavigationChange", { url: "https://example.com/a", title: "A", canGoBack: true, canGoForward: false, loading: false });
  }, id);
  const events = await page.evaluate(() => window.__gallery!.events);
  expect(events).toEqual([
    { name: "progress", args: [0.5] },
    { name: "ready", args: [7, 3] },
    { name: "navigationChange", args: [expect.objectContaining({ url: "https://example.com/a", title: "A" })] },
  ]);
  await page.evaluate(async () => {
    const handle = window.__gallery!.cef.handle()!;
    await handle.loadUrl("https://ardia.dev/", { userInitiated: true });
    await handle.goBack();
    await handle.find("needle", true, false);
  });
  const viewCalls = (await calls(page)).filter((c) => c.kind === "callView");
  expect(viewCalls.map((c) => [c.manager, c.viewId, c.method, c.args])).toEqual([
    ["ArdiaCEF", id, "loadUrl", ["https://ardia.dev/", true]],
    ["ArdiaCEF", id, "goBack", []],
    ["ArdiaCEF", id, "find", ["needle", true, false]],
  ]);
  const tag = await page.evaluate(() => (document.querySelector('[data-ardia-native-view="ArdiaCEF"]') as HTMLElement).dataset.ardiaViewId);
  expect(Number(tag)).toBe(id);

  await page.evaluate(() => window.__gallery!.cef.set({ mounted: false }));
  await nextFrames(page, 2);
  expect((await calls(page)).filter((c) => c.kind === "destroyView").map((c) => c.viewId)).toEqual([id]);
});

test("a native view in a window document reports that window's coordinates and id", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const popup = window.open("about:blank", "ardia-window-w-test", "width=500,height=400")!;
    popup.document.body.style.margin = "0";
    const node = popup.document.createElement("div");
    node.style.cssText = "position:absolute;left:33px;top:44px;width:120px;height:80px";
    popup.document.body.appendChild(node);
    const { trackerFor, windowIdOf } = (window as unknown as { __ardiaViewsTesting: { trackerFor(d: Document): { add(v: unknown): void }; windowIdOf(e: Element): string | null } }).__ardiaViewsTesting;
    const fake = window.__ardiaFakeNative!;
    fake.reset();
    const viewId = fake.createView("ArdiaCEF", {}, () => {});
    trackerFor(popup.document).add({ element: node, viewId, sent: "" });
    await new Promise((done) => popup.requestAnimationFrame(() => popup.requestAnimationFrame(done)));
    const update = fake.calls.find((c) => c.kind === "updateView") as { update: { frame: unknown } } | undefined;
    const id = windowIdOf(node);
    popup.close();
    return { frame: update?.update.frame, id };
  });
  expect(result.id).toBe("w-test");
  expect(result.frame).toEqual({ x: 33, y: 44, width: 120, height: 80 });
});

test("behaviour views: context menu, outside press, double-click region, file drop and middle click", async ({ page }) => {
  await open(page);
  await page.locator('[data-section="behaviours"]').scrollIntoViewIfNeeded();
  const box = async (name: string) => (await page.locator(`[data-behaviour="${name}"]`).boundingBox())!;
  const context = await box("context");
  await page.mouse.click(context.x + 10, context.y + 10, { button: "right" });
  const inside = await box("inside");
  await page.mouse.click(inside.x + 10, inside.y + 10);
  await page.mouse.click(context.x + 20, context.y + 20);
  await page.evaluate(() => {
    window.name = "ardia-window-w-gallery";
  });
  const press = await box("press-drag");
  await page.mouse.dblclick(press.x + 10, press.y + 10);
  const file = await box("file-drag");
  await page.mouse.click(file.x + 10, file.y + 10, { button: "middle" });
  await page.evaluate(() => {
    const target = document.querySelector('[data-behaviour="drop"]')!;
    const rect = target.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", "https://example.com/dropped");
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.x + 5, clientY: rect.y + 6 }));
    }
  });
  await page.evaluate(() => {
    const inside = document.querySelector('[data-behaviour="inside"]')!.getBoundingClientRect();
    const fake = window.__ardiaFakeNative!;
    fake.emit("ArdiaViews", "onNativePress", { windowId: "w-gallery", x: inside.x + 4, y: inside.y + 4 });
    fake.emit("ArdiaViews", "onNativePress", { windowId: "w-other", x: 1, y: 1 });
    fake.emit("ArdiaViews", "onNativePress", { windowId: "w-gallery", x: 1, y: 1 });
  });
  await page.waitForTimeout(50);
  const events = await page.evaluate(() => window.__gallery!.events.map((e) => [e.name, e.args]));
  expect(events.filter(([name]) => name === "contextMenu").length).toBe(1);
  expect(events.filter(([name]) => name === "outsidePress").length).toBe(6);
  expect(events.filter(([name]) => name === "regionDoubleClick").length).toBe(1);
  expect(events.find(([name]) => name === "middleClick")?.[1]).toEqual([{ shiftKey: false, altKey: false, metaKey: false }]);
  const drops = events.filter(([name]) => name === "drop").map(([, args]) => (args as { phase: string; x: number; y: number; count: number; items: unknown[] }[])[0]!);
  expect(drops.map((d) => d.phase)).toEqual(["enter", "move", "drop"]);
  expect(drops[2]).toMatchObject({ x: 5, y: 6, count: 1, items: [{ kind: "url", url: "https://example.com/dropped" }] });
  const drag = await page.evaluate(() => getComputedStyle(document.querySelector('[data-behaviour="drag"] [data-ardia-drag-region]')!).getPropertyValue("app-region"));
  expect(drag).toBe("drag");
  const beginDrag = await page.evaluate(() => window.__ardiaFakeNative!.calls.filter((c) => c.kind === "call" && c.method === "beginWindowDrag").map((c) => (c as { module: string; args: unknown[] }).args));
  expect(beginDrag).toEqual([["w-gallery"]]);
});
