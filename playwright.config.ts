import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: [
    {
      command: "npm run mock-api",
      url: "http://127.0.0.1:7878/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run dev:harness",
      url: "http://127.0.0.1:4173/?harness=1",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
});
