import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const here = __dirname;
const pagesDir = join(here, "pages");
export const shotsDir = resolve(here, "../../../build-linux/e2e-shots");
const APP_VERSION = "0.2.40";

export type TabSummary = { id: string; url: string; title: string; pinned: boolean; windowId: string };
export type StoreSummary = {
  windows: { id: string; activeTabId: string | null; tabIds: string[]; kind: string }[];
  tabs: TabSummary[];
  focusedWindowId: string | null;
};
export type WebViewSummary = {
  viewId: number;
  windowId: string | null;
  browserId: number;
  url: string | null;
  title: string | null;
  loading: boolean;
  visible: boolean;
  frame: { x: number; y: number; width: number; height: number } | null;
};

export type Ardia = {
  host: Page;
  win: Page;
  windows: Page[];
  page(name: string): string;
  store(): Promise<StoreSummary>;
  webViews(): Promise<WebViewSummary[]>;
  mock<T>(fn: string, ...args: unknown[]): Promise<T>;
  shot(name: string, page?: Page): Promise<void>;
  openUrlInNewTab(url: string, page?: Page): Promise<void>;
  waitForWindow(index: number): Promise<Page>;
  activeTab(windowId?: string): Promise<TabSummary | null>;
  visibleFrameHeading(page?: Page): Promise<string>;
  sidebarRow(title: string, page?: Page): ReturnType<Page["locator"]>;
};

const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

export const seededDocuments = () => ({
  "perf-probe": "",
  "onboarding.json": JSON.stringify({ version: 1, completedAt: Date.now() - 864e5, startedAt: Date.now() - 864e5 }),
  "telemetry.json": JSON.stringify({
    version: 1,
    sharing: false,
    decidedAt: Date.now() - 864e5,
    askDoneAt: Date.now() - 864e5,
    installId: null,
    crashCursor: 0,
    lastVersion: APP_VERSION,
    sessionOpen: false,
  }),
});

async function routeTestPages(context: BrowserContext) {
  await context.route(/\/e2e-pages\//, async (route) => {
    const path = new URL(route.request().url()).pathname.split("/e2e-pages/")[1] ?? "";
    const file = resolve(pagesDir, decodeURIComponent(path));
    if (!file.startsWith(pagesDir)) return route.fulfill({ status: 404 });
    try {
      await route.fulfill({ status: 200, contentType: contentTypes[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
    } catch {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
}

export const test = base.extend<{ ardia: Ardia; mockOptions: Record<string, unknown> }>({
  mockOptions: [{}, { option: true }],
  ardia: async ({ context, baseURL, mockOptions }, use) => {
    await routeTestPages(context);
    const options = { persist: "memory", isolatedInstance: true, autoConfirm: true, ...mockOptions, documents: { ...seededDocuments(), ...((mockOptions.documents as object) ?? {}) } };
    await context.addInitScript((value) => {
      if (window.opener || window.parent !== window) return;
      (window as unknown as { __ardiaMockOptions: unknown }).__ardiaMockOptions = value;
    }, options);
    const errors: string[] = [];
    const windows: Page[] = [];
    context.on("page", (page) => {
      page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.stack ?? error.message}`));
      if (page.url() === "about:blank" || /window\.html/.test(page.url())) windows.push(page);
    });
    const host = await context.newPage();
    windows.length = 0;
    host.on("pageerror", (error) => errors.push(`host: ${error.stack ?? error.message}`));
    const firstWindow = context.waitForEvent("page", { timeout: 20000 });
    await host.goto(new URL("dev.html", baseURL).href);
    const win = await firstWindow;
    await win.waitForLoadState("domcontentloaded");
    await expect.poll(() => host.evaluate(() => typeof (globalThis as { ac?: unknown }).ac), { timeout: 15000 }).toBe("object");
    await expect.poll(() => host.evaluate(() => window.__ardiaMock?.openWindowIds().length ?? 0), { timeout: 15000 }).toBeGreaterThan(0);

    const store = () =>
      host.evaluate(() => {
        const state = (globalThis as unknown as { ac: { store: { getState(): Record<string, unknown> } } }).ac.store.getState() as {
          windows: Record<string, { id: string; profileId: string; activeTabIds: Record<string, string>; tabIds: string[]; kind?: string }>;
          tabs: Record<string, { id: string; url: string; title: string; pinned: boolean; windowId: string }>;
          focusedWindowId?: string | null;
        };
        return {
          windows: Object.values(state.windows).map((w) => ({ id: w.id, activeTabId: w.activeTabIds[w.profileId] ?? null, tabIds: [...w.tabIds], kind: w.kind ?? "browser" })),
          tabs: Object.values(state.tabs).map((t) => ({ id: t.id, url: t.url, title: t.title, pinned: t.pinned, windowId: t.windowId })),
          focusedWindowId: state.focusedWindowId ?? null,
        };
      });

    const ardia: Ardia = {
      host,
      win,
      windows,
      page: (name) => new URL(`e2e-pages/${name}`, baseURL).href,
      store,
      webViews: () => host.evaluate(() => window.__ardiaMock!.webViews() as never),
      mock: (fn, ...args) =>
        host.evaluate(([name, values]) => {
          const target = (window.__ardiaMock as unknown as Record<string, (...a: unknown[]) => unknown>)[name as string]!;
          return target(...(values as unknown[])) as never;
        }, [fn, args] as const),
      async shot(name, page = win) {
        mkdirSync(shotsDir, { recursive: true });
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(shotsDir, `${name}.png`) });
      },
      async openUrlInNewTab(url, page = win) {
        await page.keyboard.press("Control+t");
        const field = page.locator("input:focus, textarea:focus");
        await expect(field).toHaveCount(1);
        await page.keyboard.type(url);
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await ardia.webViews()).some((view) => view.url === url && !view.loading && view.visible)).toBe(true);
      },
      async waitForWindow(index) {
        await expect.poll(() => windows.filter((page) => !page.isClosed()).length, { timeout: 15000 }).toBeGreaterThan(index);
        const page = windows.filter((candidate) => !candidate.isClosed())[index]!;
        await page.waitForLoadState("domcontentloaded");
        return page;
      },
      async activeTab(windowId) {
        const summary = await store();
        const target = summary.windows.find((w) => w.id === (windowId ?? summary.focusedWindowId)) ?? summary.windows.find((w) => w.kind === "browser");
        return summary.tabs.find((tab) => tab.id === target?.activeTabId) ?? null;
      },
      sidebarRow: (title, page = win) => page.locator("[tabindex]").filter({ hasText: title }).last(),
      async visibleFrameHeading(page = win) {
        const frame = page.locator("[data-ardia-mock-webview]:visible");
        await expect(frame).toHaveCount(1);
        return (await frame.contentFrame().locator("#heading").textContent()) ?? "";
      },
    };
    await use(ardia);
    expect(errors, "uncaught errors in the app").toEqual([]);
  },
});

export { expect };
