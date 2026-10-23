import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./fixtures";

const nativeApiVersion = () => {
  const source = readFileSync(resolve(__dirname, "../../../src/nativeApi.tsx"), "utf8");
  return Number(/NATIVE_API_VERSION = (\d+)/.exec(source)?.[1]);
};

test("the app boots into a window with the sidebar", async ({ ardia }) => {
  const { host, win } = ardia;
  expect(await win.evaluate(() => window.opener != null && location.pathname.endsWith("/window.html"))).toBe(true);
  await expect(win.getByText("New Tab", { exact: true }).first()).toBeVisible();
  const summary = await ardia.store();
  expect(summary.windows.filter((w) => w.kind === "browser")).toHaveLength(1);
  const windowId = summary.windows[0]!.id;
  expect(await win.evaluate(() => window.name)).toBe(`ardia-window-${windowId}`);
  expect(await host.evaluate(() => window.__ardiaMock!.focusedWindowId())).toBe(windowId);
  await expect.poll(() => win.title()).not.toBe("");
  await ardia.shot("boot");
});

test("the mock engine implements every module method in the spec", async ({ ardia }) => {
  expect(await ardia.mock<string[]>("missing")).toEqual([]);
  expect(await ardia.mock<string[]>("unknownHandlers")).toEqual([]);
  const constants = await ardia.host.evaluate(() => window.ardiaNative!.constants());
  expect(constants.ArdiaApp?.apiVersion).toBe(nativeApiVersion());
});

test("sync methods answer synchronously and async ones through promises", async ({ ardia }) => {
  const result = await ardia.host.evaluate(() => {
    const native = window.ardiaNative!;
    const info = native.callSync("ArdiaApp", "systemInfo", []) as { appName: string };
    native.callSync("ArdiaShell", "writeDocument", ["e2e-check", "hello"]);
    const read = native.callSync("ArdiaShell", "readDocument", ["e2e-check"]);
    const pending = native.call("ArdiaShell", "isDarkAppearance", []);
    return Promise.all([info.appName, read, pending instanceof Promise, pending]);
  });
  expect(result).toEqual(["Ardia", "hello", true, false]);
});
