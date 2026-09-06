import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Two-core runners starve six parallel dev-mode pages; cap workers in CI.
  workers: process.env.CI ? 2 : undefined,
  testDir: "./e2e",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "bun run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
});
