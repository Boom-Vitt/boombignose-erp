import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const roots = ["app", "components", "ee", "lib"]

function sourceFiles(dir: string, out: string[]) {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const full = path.join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) {
      sourceFiles(full, out)
      continue
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(name) || name.includes(".test.")) continue
    out.push(full)
  }
  return out
}

function isClientModule(source: string) {
  const lines = source.split(/\r?\n/).slice(0, 20)
  return lines.some((line) => {
    const trimmed = line.trim()
    return trimmed === '"use client"' || trimmed === "'use client'" || trimmed === '"use client";' || trimmed === "'use client';"
  })
}

describe("service role stays on the server", () => {
  it("does not import the admin client from a client module", () => {
    const leaks: string[] = []
    for (const root of roots) {
      for (const file of sourceFiles(path.join(repoRoot, root), [])) {
        const source = readFileSync(file, "utf8")
        if (!isClientModule(source)) continue
        if (
          source.includes("lib/supabase/admin") ||
          source.includes("createAdminClient") ||
          source.includes("SUPABASE_SERVICE_ROLE_KEY") ||
          source.includes("SERVICE_ROLE_KEY")
        ) {
          leaks.push(path.relative(repoRoot, file))
        }
      }
    }
    expect(leaks).toEqual([])
  })
})
