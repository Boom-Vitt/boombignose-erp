import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("supabase migrations", () => {
  it("have unique version prefixes", () => {
    const versions = readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.split("_")[0])
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index)
    expect(duplicates).toEqual([])
  })
})
