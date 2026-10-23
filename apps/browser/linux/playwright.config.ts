import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ARDIA_LINUX_E2E_PORT ?? 8791);

export default defineConfig({
  testDir: ".",
  testMatch: ["runtime/testing/**/*.spec.ts", "dev/e2e/**/*.spec.ts"],
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  reporter: [["list"]],
  outputDir: "../build-linux/e2e-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}/`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node linux/scripts/build-ui.mjs --testing --serve --port ${port} --out build-linux/ui-e2e`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/testing.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
