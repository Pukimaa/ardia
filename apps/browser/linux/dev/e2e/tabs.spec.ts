import { expect, test } from "./fixtures";

test("a new tab opens and navigates to a local page", async ({ ardia }) => {
  const { win } = ardia;
  const alpha = ardia.page("alpha.html");
  await ardia.openUrlInNewTab(alpha);
  await expect.poll(async () => (await ardia.activeTab())?.title).toBe("Alpha Test Page");
  expect(await ardia.visibleFrameHeading()).toBe("Alpha");
  await expect(win.getByText("Alpha Test Page").first()).toBeVisible();
  const [view] = (await ardia.webViews()).filter((candidate) => candidate.visible);
  expect(view!.frame!.width).toBeGreaterThan(400);
  expect(view!.frame!.x).toBeGreaterThan(0);
  await ardia.shot("tab-alpha");

  await win.locator("[data-ardia-mock-webview]:visible").contentFrame().locator("#to-beta").click();
  await expect.poll(async () => (await ardia.activeTab())?.title).toBe("Beta Test Page");
  expect(await ardia.visibleFrameHeading()).toBe("Beta");
  await ardia.shot("tab-beta");

  await win.keyboard.press("Alt+ArrowLeft");
  await expect.poll(async () => (await ardia.activeTab())?.url).toBe(alpha);
  expect(await ardia.visibleFrameHeading()).toBe("Alpha");
});

test("tabs switch, close and reopen", async ({ ardia }) => {
  const { win } = ardia;
  await ardia.openUrlInNewTab(ardia.page("alpha.html"));
  await ardia.openUrlInNewTab(ardia.page("gamma.html"));
  await expect.poll(async () => (await ardia.activeTab())?.title).toBe("Gamma Test Page");

  await ardia.sidebarRow("Alpha Test Page").click({ timeout: 10000 });
  await expect.poll(async () => (await ardia.activeTab())?.title).toBe("Alpha Test Page");
  expect(await ardia.visibleFrameHeading()).toBe("Alpha");
  await ardia.shot("tabs-switched");

  await win.keyboard.press("Control+w");
  await expect.poll(async () => (await ardia.store()).tabs.some((tab) => tab.title === "Alpha Test Page")).toBe(false);
  await ardia.shot("tab-closed");
  await expect(ardia.sidebarRow("Alpha Test Page")).toHaveCount(0);

  await win.keyboard.press("Control+Shift+t");
  await expect.poll(async () => (await ardia.activeTab())?.title).toBe("Alpha Test Page");
  expect(await ardia.visibleFrameHeading()).toBe("Alpha");
  await expect(win.getByText("Alpha Test Page").first()).toBeVisible();
  await ardia.shot("tab-reopened");
});

test("a tab pins and unpins", async ({ ardia }) => {
  const { win } = ardia;
  await ardia.openUrlInNewTab(ardia.page("beta.html"));
  const tab = await ardia.activeTab();
  expect(tab?.pinned).toBe(false);

  await ardia.sidebarRow("Beta Test Page").click({ button: "right", timeout: 10000 });
  const pin = win.locator('[data-ardia-mock-menu] [role="menuitem"]', { hasText: /^Pin/ }).first();
  await expect(pin).toBeVisible();
  await ardia.shot("tab-context-menu");
  await pin.click();
  await expect.poll(async () => (await ardia.store()).tabs.find((candidate) => candidate.id === tab!.id)?.pinned).toBe(true);
  await ardia.shot("tab-pinned");

  await ardia.mock("command", "togglePin");
  await expect.poll(async () => (await ardia.store()).tabs.find((candidate) => candidate.id === tab!.id)?.pinned).toBe(false);
});

test("links with target=_blank open a new tab", async ({ ardia }) => {
  const { win } = ardia;
  await ardia.openUrlInNewTab(ardia.page("alpha.html"));
  const before = (await ardia.store()).tabs.length;
  await win.locator("[data-ardia-mock-webview]:visible").contentFrame().locator("#new-tab").click();
  await expect.poll(async () => (await ardia.store()).tabs.length).toBe(before + 1);
  await expect.poll(async () => (await ardia.store()).tabs.some((tab) => tab.url.endsWith("beta.html#from-alpha"))).toBe(true);
});
