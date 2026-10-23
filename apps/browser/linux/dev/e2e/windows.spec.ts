import { expect, test } from "./fixtures";

test("a second window opens and shares the store with the first", async ({ ardia }) => {
  const { win, host } = ardia;
  await ardia.openUrlInNewTab(ardia.page("alpha.html"));
  await win.keyboard.press("Control+n");
  const second = await ardia.waitForWindow(1);
  await expect.poll(async () => (await ardia.store()).windows.filter((w) => w.kind === "browser").length).toBe(2);
  const summary = await ardia.store();
  const [firstId, secondId] = summary.windows.map((w) => w.id);
  expect(await second.evaluate(() => window.name)).toBe(`ardia-window-${secondId}`);
  expect(await second.evaluate(() => window.opener === window.opener?.window && typeof (window.opener as { ac?: unknown }).ac)).toBe("object");
  await expect.poll(() => host.evaluate(() => window.__ardiaMock!.focusedWindowId())).toBe(secondId);

  await ardia.openUrlInNewTab(ardia.page("gamma.html"), second);
  const after = await ardia.store();
  const gamma = after.tabs.find((tab) => tab.title === "Gamma Test Page");
  expect(gamma?.windowId).toBe(secondId);
  expect(after.tabs.find((tab) => tab.title === "Alpha Test Page")?.windowId).toBe(firstId);
  expect(await ardia.visibleFrameHeading(second)).toBe("Gamma");
  expect(await ardia.visibleFrameHeading(win)).toBe("Alpha");
  await ardia.shot("second-window", second);

  const alpha = after.tabs.find((tab) => tab.title === "Alpha Test Page")!;
  const pinnedArea = { x: 0, y: 40, width: 190, height: 70 };
  const beforePin = await second.screenshot({ clip: pinnedArea });
  await ardia.mock("command", "togglePin", null, firstId);
  await expect.poll(async () => (await ardia.store()).tabs.find((tab) => tab.id === alpha.id)?.pinned).toBe(true);
  await expect.poll(async () => (await ardia.store()).tabs.filter((tab) => tab.title === "Alpha Test Page" && tab.pinned).map((tab) => tab.windowId).sort()).toEqual([firstId, secondId].sort());
  await expect.poll(async () => (await second.screenshot({ clip: pinnedArea })).equals(beforePin)).toBe(false);
  await ardia.shot("second-window-pinned-mirror", second);

  const closed = second.waitForEvent("close");
  await second.keyboard.press("Control+Shift+w").catch(() => {});
  await closed;
  await expect.poll(async () => (await ardia.store()).windows.filter((w) => w.kind === "browser").length).toBe(1);
  await expect.poll(() => second.isClosed()).toBe(true);
});
