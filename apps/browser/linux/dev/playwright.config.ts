import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ARDIA_MOCK_E2E_PORT ?? 8793);

export default defineConfig({
  testDir: "e2e",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: [["list"]],
  outputDir: "../../build-linux/e2e-mock-results",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    baseURL: `http://127.0.0.1:${port}/`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node linux/dev/serve.mjs --port ${port}`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
