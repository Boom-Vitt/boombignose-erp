import { mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { readStartLog, redactLog } from "@/lib/install/logs"

describe("readStartLog", () => {
  it("returns the tail of an allowlisted log and redacts a database URL and a token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bbn-logs-"))
    const head = `${"x".repeat(70_000)}\n`
    const tail = "ready\npostgres://user:secret@127.0.0.1/db\neyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signaturevalue\npassword=hunter2\n"
    await writeFile(path.join(dir, "server.log"), head + tail)
    const result = await readStartLog(dir, "server.log")
    expect(result).toEqual({ text: expect.stringContaining("ready") })
    if (!("text" in result)) throw new Error("expected text")
    expect(result.text.length).toBeLessThanOrEqual(64 * 1024)
    expect(result.text).not.toContain("secret")
    expect(result.text).not.toContain("hunter2")
    expect(result.text).not.toContain("eyJ")
    expect(result.text).toContain("[redacted]")
    expect(result.text.startsWith("x".repeat(100))).toBe(false)
  })

  it("refuses a name outside the allowlist and a link that leaves the data directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bbn-logs-"))
    const outside = await mkdtemp(path.join(tmpdir(), "bbn-outside-"))
    await writeFile(path.join(outside, "secret.txt"), "secret-token")
    await symlink(path.join(outside, "secret.txt"), path.join(dir, "server.log"))
    await writeFile(path.join(dir, "notes.txt"), "private")
    expect(await readStartLog(dir, "server.log")).toEqual({ error: "That log cannot be read." })
    expect(await readStartLog(dir, "notes.txt")).toEqual({ error: "That log is not available." })
    expect(await readStartLog(dir, "../server.log")).toEqual({ error: "That log is not available." })
    expect(JSON.stringify(await readStartLog(dir, "server.log"))).not.toContain("secret-token")
  })

  it("redacts a jwt without reading a file", () => {
    expect(redactLog("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signaturevalue")).toBe("[redacted]")
  })
})
