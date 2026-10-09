import { defineConfig } from "@playwright/test";

// `E2E_PORT` overrides the default 4311 so the suite can run alongside a dev
// server or another checkout.
const e2ePort = Number(process.env.E2E_PORT ?? 4311);

export default defineConfig({
  workers: process.env.CI ? 2 : undefined,
  testDir: "./e2e",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: { baseURL: `http://127.0.0.1:${e2ePort}`, trace: "retain-on-failure" },
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${e2ePort}`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: true,
  },
});
