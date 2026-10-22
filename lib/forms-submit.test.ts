import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The house Button (Base UI) renders type="button" unless told otherwise, so a <form> needs an explicit submit control.
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : tsxFiles(path)
    return path.endsWith(".tsx") ? [path] : []
  })
}

describe("forms", () => {
  it("each file has a real submit control per <form>", () => {
    const offenders = ["app", "components", "ee"].flatMap((root) => tsxFiles(join(process.cwd(), root))).filter((file) => {
      const source = readFileSync(file, "utf8")
      const forms = source.match(/<form[\s>]/g)?.length ?? 0
      // onSubmit alone is not enough: the house Button never submits without type="submit".
      const submits = (source.match(/type="submit"|type=\{"submit"\}|requestSubmit\(|form-submit: implicit/g)?.length ?? 0) +
        (source.match(/<button(?![^>]*\btype=)[\s>]/g)?.length ?? 0)
      return submits < forms
    })
    expect(offenders).toEqual([])
  })
})
