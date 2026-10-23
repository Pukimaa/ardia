import { expect, test } from "./fixtures";

test("the command bar opens with Ctrl+T and Ctrl+L and filters", async ({ ardia }) => {
  const { win } = ardia;
  await ardia.openUrlInNewTab(ardia.page("alpha.html"));
  await ardia.openUrlInNewTab(ardia.page("beta.html"));

  await win.keyboard.press("Control+l");
  const field = win.locator("input:focus, textarea:focus");
  await expect(field).toHaveCount(1);
  await expect(field).toHaveValue(/beta\.html|Beta|127\.0\.0\.1/);
  await ardia.shot("command-bar-open");

  await win.keyboard.press("Control+a");
  await win.keyboard.type("Alpha Test");
  await expect(win.getByText("Alpha Test Page").first()).toBeVisible();
  await ardia.shot("command-bar-filtered");

  await win.keyboard.press("Escape");
  await expect(win.locator("input:focus, textarea:focus")).toHaveCount(0);
  expect((await ardia.activeTab())?.title).toBe("Beta Test Page");

  await win.keyboard.press("Control+t");
  await expect(win.locator("input:focus, textarea:focus")).toHaveCount(1);
  await win.keyboard.type("gamma.html");
  await expect(win.locator("input:focus, textarea:focus")).toHaveValue(/gamma\.html/);
  await ardia.shot("command-bar-new-tab");
});
