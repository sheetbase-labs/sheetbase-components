import { defineConfig } from "@playwright/test";

// `E2E_PORT` overrides the default 4173 so the suite can run alongside a dev
// server or in parallel with another checkout. The CLI `--port` flag is set
// explicitly below so it always wins over `PORT` in the Vite config.
const e2ePort = Number(process.env.E2E_PORT ?? 4173);

// The v3 design-fixture comparisons (e2e/specs/v3-grids.spec.ts) match crops
// of the ELN design renders, which only rasterise identically on the machine
// that cut them. They are opt-in (`bun run test:visual`) and not part of the
// default suite or CI.
const visual = process.env.E2E_VISUAL === "1";

export default defineConfig({
  // Two-core runners starve six parallel dev-mode pages; cap workers in CI.
  workers: process.env.CI ? 2 : undefined,
  testDir: "./e2e",
  testIgnore: visual ? undefined : ["**/specs/v3-grids.spec.ts"],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: { baseURL: `http://127.0.0.1:${e2ePort}`, trace: "retain-on-failure" },
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${e2ePort}`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: true,
  },
});
