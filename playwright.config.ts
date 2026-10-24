import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const fixtures = join(__dirname, "tests/e2e/.fixtures");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "web", testMatch: /web\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "mirror",
      testMatch: /mirror\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${join(fixtures, "person.mjpeg")}`]
        }
      }
    },
    { name: "extension", testMatch: /extension\.spec\.ts/ }
  ],
  webServer: [
    {
      command: "node tests/e2e/start-api.mjs",
      url: "http://127.0.0.1:8787/v1/health",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore"
    },
    {
      command: "npm run build -w @fitlens/web && npm run preview -w @fitlens/web -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 180_000
    }
  ]
});
