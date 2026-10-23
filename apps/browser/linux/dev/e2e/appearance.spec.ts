import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const sidebarBackground = (page: Page) =>
  page.evaluate(() => {
    const luminance = (color: string) => {
      const [r, g, b] = (color.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const canvas = document.querySelector("canvas");
    const root = document.getElementById("root")!;
    const element = document.elementFromPoint(40, window.innerHeight - 40) as HTMLElement | null;
    let node: HTMLElement | null = element;
    while (node && node !== root) {
      const background = getComputedStyle(node).backgroundColor;
      if (background && !/rgba\(0, 0, 0, 0\)|transparent/.test(background)) return luminance(background);
      node = node.parentElement;
    }
    return canvas ? -1 : luminance(getComputedStyle(document.body).backgroundColor);
  });

test("light and dark appearance", async ({ ardia }) => {
  const { win, host } = ardia;
  await ardia.openUrlInNewTab(ardia.page("alpha.html"));
  await ardia.mock("command", "setAppearance", "light");
  await expect.poll(() => host.evaluate(() => window.__ardiaMock!.state().dark)).toBe(false);
  await ardia.shot("appearance-light");
  const light = await win.screenshot();

  await ardia.mock("command", "setAppearance", "dark");
  await expect.poll(() => host.evaluate(() => window.__ardiaMock!.state().dark)).toBe(true);
  await expect.poll(() => host.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
  expect(await ardia.store().then(() => host.evaluate(() => (globalThis as unknown as { ac: { store: { getState(): { settings: { appearance: string } } } } }).ac.store.getState().settings.appearance))).toBe("dark");
  await ardia.shot("appearance-dark");
  const dark = await win.screenshot();
  expect(dark.equals(light)).toBe(false);
  const lightness = await sidebarBackground(win);
  if (lightness >= 0) expect(lightness).toBeLessThan(128);

  await ardia.mock("command", "setAppearance", "auto");
  await ardia.mock("setSystemDark", false);
  await expect.poll(() => host.evaluate(() => window.__ardiaMock!.state().dark)).toBe(false);
});
