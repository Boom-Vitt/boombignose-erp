import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// The product is "BoomBigNose ERP" for businesses of every size; legal files, migrations and internal docs keep their history.
const root = fileURLToPath(new URL("..", import.meta.url))
const surfaces = ["app", "components", "ee", "hooks", "lib", "public", "site", ".github", "proxy.ts", "README.md", "README.th.md", "SECURITY.md", "CONTRIBUTING.md", ".env.example"]
const retired = [/company[\s_-]?os/i, /🐘/u, /AI studio/i, /สตูดิโอสาย AI/, /ระบบปฏิบัติการ(ธุรกิจ|ของบริษัท)/]

function files(path: string): string[] {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((name) => (name === "node_modules" ? [] : files(join(path, name))))
}

describe("branding", () => {
  it("user-facing surfaces use the ERP name", () => {
    const scanned = surfaces.flatMap((surface) => files(join(root, surface))).filter((file) => !file.endsWith("branding.test.ts"))
    const offenders = scanned.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return retired.filter((pattern) => pattern.test(source)).map((pattern) => `${relative(root, file)} ${pattern}`)
    })
    expect(scanned.length).toBeGreaterThan(100)
    expect(offenders).toEqual([])
  })
})
