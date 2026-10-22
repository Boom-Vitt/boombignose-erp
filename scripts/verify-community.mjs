import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const root = process.cwd()
const temporary = mkdtempSync(path.join(tmpdir(), "bbn-community-"))
try {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root }).toString().split("\0").filter(Boolean)
  for (const file of new Set(files)) {
    if (file.startsWith("ee/") || !existsSync(path.join(root, file))) continue
    const destination = path.join(temporary, file)
    mkdirSync(path.dirname(destination), { recursive: true })
    cpSync(path.join(root, file), destination)
  }
  cpSync(path.join(root, "node_modules"), path.join(temporary, "node_modules"), {
    recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
  })
  assert.equal(existsSync(path.join(temporary, "ee")), false)
  const env = { ...process.env, BBN_EDITION: "community" }
  for (const args of [
    ["install", "--frozen-lockfile", "--offline"],
    ["exec", "tsc", "--noEmit"],
    ["lint"],
    ["test"],
    ["build"],
  ]) {
    console.log(`Community without ee/: pnpm ${args.join(" ")}`)
    const result = spawnSync("pnpm", args, { cwd: temporary, env, stdio: "inherit" })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `Community check failed: pnpm ${args.join(" ")}`)
  }
  console.log("PASS. Community installs, typechecks, lints, tests, and builds with ee/ physically absent.")
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
