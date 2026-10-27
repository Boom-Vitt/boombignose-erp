import { defineConfig, devices } from "@playwright/test"
import { homedir } from "node:os"
import { join } from "node:path"

const PORT = 3987
const baseURL = `http://127.0.0.1:${PORT}`

const defaultExecutablePath = join(
  homedir(),
  "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell"
)

const executablePath =
  process.env.ERP_PLAYWRIGHT_EXECUTABLE_PATH || defaultExecutablePath

export default defineConfig({
  testDir: "./e2e-blueprint",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "off",
    launchOptions: {
      executablePath,
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  projects: [
    {
      name: "chromium-blueprint",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm start -H 127.0.0.1 -p ${PORT}`,
    url: `${baseURL}/blueprint-preview`,
    reuseExistingServer: false,
    env: {
      ERP_BLUEPRINT_PREVIEW: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy",
      OLLAMA_HOST: "127.0.0.1:1",
      RESEND_API_KEY: "",
    },
    timeout: 120_000,
  },
})
