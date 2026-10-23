import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ARDIA_VIEWS_GALLERY_PORT ?? 8795);

export default defineConfig({
  testDir: ".",
  testMatch: ["gallery/**/*.spec.ts"],
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  reporter: [["list"]],
  outputDir: "../../build-linux/gallery-results",
  use: {
    ...devices["Desktop Chrome"],
    deviceScaleFactor: 2,
    viewport: { width: 1600, height: 1200 },
    baseURL: `http://127.0.0.1:${port}/`,
  },
  webServer: {
    command: `node linux/views/gallery/build.mjs --serve --port ${port}`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}/gallery.html`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
