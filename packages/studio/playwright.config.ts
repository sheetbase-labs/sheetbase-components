import { defineConfig } from "@playwright/test";

// `E2E_PORT` overrides the default so the suite can run beside a dev server.
const e2ePort = Number(process.env.E2E_PORT ?? 4214);
// A preinstalled Chromium (e.g. a locked-down runner) can be used instead of
// `playwright install` by pointing E2E_CHROMIUM at its executable.
const executablePath = process.env.E2E_CHROMIUM || undefined;

export default defineConfig({
  workers: process.env.CI ? 2 : undefined,
  testDir: "./e2e",
  timeout: 60_000,
  projects: [{ name: "chromium", use: { browserName: "chromium", launchOptions: executablePath ? { executablePath } : {} } }],
  use: { baseURL: `http://127.0.0.1:${e2ePort}`, trace: "retain-on-failure" },
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
