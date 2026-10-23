import { expect, test } from "./fixtures";

test("settings open in their own window", async ({ ardia }) => {
  const { win, host } = ardia;
  await win.keyboard.press("Control+,");
  await expect
    .poll(() => host.evaluate(() => window.__ardiaMock!.windows().filter((w) => w.open).map((w) => w.kind)))
    .toContain("settings");
  const settings = await ardia.waitForWindow(1);
  await expect(settings.getByText(/General|Appearance/).first()).toBeVisible();
  await ardia.shot("settings", settings);
  const closed = settings.waitForEvent("close");
  await settings.keyboard.press("Control+Shift+w").catch(() => {});
  await closed;
  await expect.poll(() => settings.isClosed()).toBe(true);
});
