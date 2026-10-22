import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli")
const edition = resolve("e2e/edition")

// Loads e2e/edition.ts through Playwright's own TS loader in a workspace holding only this .env.local.
function playwrightEdition(envLocal: string, shell?: string) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-edition-"))
  try {
    writeFileSync(join(dir, ".env.local"), envLocal)
    writeFileSync(join(dir, "playwright.config.ts"), `import { community } from ${JSON.stringify(edition)}\nconsole.log(\`EDITION \${community}\`)\nexport default {}\n`)
    // Vitest sets NODE_ENV=test, under which Next skips .env.local; Playwright and next build run without it.
    const { NODE_ENV: _test, BBN_EDITION: _edition, ...env } = process.env
    const run = spawnSync(process.execPath, [cli, "test", "--list"], { cwd: dir, env: shell ? { ...env, BBN_EDITION: shell } : env, encoding: "utf8" })
    return `${run.stdout}${run.stderr}`.match(/EDITION (true|false)|BBN_EDITION must be community or pro/)?.[0]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

it("reads a quoted .env.local edition the way next build does", { timeout: 15_000 }, () => {
  expect(playwrightEdition('BBN_EDITION="pro"\n')).toBe("EDITION false")
})
it("ignores a trailing .env.local comment", { timeout: 15_000 }, () => {
  expect(playwrightEdition("BBN_EDITION=pro # Pro build\n")).toBe("EDITION false")
})
it("lets the shell edition override .env.local", { timeout: 15_000 }, () => {
  expect(playwrightEdition("BBN_EDITION=pro\n", "community")).toBe("EDITION true")
})
it("fails loudly on an edition next.config.ts rejects", { timeout: 15_000 }, () => {
  expect(playwrightEdition("BBN_EDITION=enterprise\n")).toBe("BBN_EDITION must be community or pro")
})
