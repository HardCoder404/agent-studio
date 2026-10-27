import { defineConfig } from "@playwright/test";

// Runs against a live stack (api on :8000, web on :3000) with real model calls.
// `npm run e2e` locally; not part of CI.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  reporter: [["list"]],
});
