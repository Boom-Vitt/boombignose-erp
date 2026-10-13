import { defineConfig, devices } from "@playwright/test"
import { readFileSync } from "node:fs"
const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const baseURL = `http://127.0.0.1:${isolation.app}`
if (process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL !== baseURL) throw new Error("Playwright must use this worktree's isolated server")

/**
 * Smoke E2E. Assumes the local Supabase stack is running and seeded, and
 * `.env.local` is set. Run with: `pnpm e2e` (starts `pnpm dev` if needed).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    launchOptions: { executablePath: process.env.ERP_PLAYWRIGHT_EXECUTABLE_PATH },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${isolation.app}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
