import { EventEmitter } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  assertSafeSupabaseArgs,
  EXPECTED_PROJECT_ID,
  mapStatusEnvToServerEnv,
  prepareCachedBuild,
  runDoctor,
  runServe,
  runStop,
  runSupabase,
  runUp,
  validateLocalSupabaseUrl,
  verifyErpWorkdir,
} from "./stack.mjs"

const tempDirs: string[] = []

function makeTempErpDir(withValidConfig = true): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "erp-stack-test-"))
  tempDirs.push(dir)
  if (withValidConfig) {
    mkdirSync(path.join(dir, "supabase"), { recursive: true })
    writeFileSync(
      path.join(dir, "supabase", "config.toml"),
      `project_id = "${EXPECTED_PROJECT_ID}"\n`
    )
  }
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("local stack manager", () => {
  it("never runs db reset or stop --no-backup", async () => {
    const erpDir = makeTempErpDir(true)
    const calls: Array<{ cmd: string; args: string[] }> = []
    const runner = {
      async exec(cmd: string, args: string[]) {
        calls.push({ cmd, args })
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    expect(() =>
      assertSafeSupabaseArgs(["db", "reset", "--workdir", erpDir])
    ).toThrow(/forbidden/i)
    expect(() =>
      assertSafeSupabaseArgs(["stop", "--no-backup", "--workdir", erpDir])
    ).toThrow(/forbidden/i)

    await expect(
      runSupabase(runner, erpDir, ["db", "reset"])
    ).rejects.toThrow(/forbidden/i)
    await expect(
      runSupabase(runner, erpDir, ["stop", "--no-backup"])
    ).rejects.toThrow(/forbidden/i)

    await runStop({ erpDir, runner })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual(["stop", "--workdir", erpDir])
    expect(calls[0].args).not.toContain("--no-backup")
  })

  it("maps supabase status env to the ERP server env", () => {
    const stdout = [
      "Stopped services: [supabase_studio_boombignose-erp]",
      'API_URL="http://127.0.0.1:54421"',
      'ANON_KEY="anon-short"',
      'SERVICE_ROLE_KEY="srv-short"',
    ].join("\n")

    const env = mapStatusEnvToServerEnv(stdout, 3100, {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/home",
    })

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54421")
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-short")
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("srv-short")
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3100")
  })

  it("refuses a non-local Supabase URL", () => {
    expect(() =>
      validateLocalSupabaseUrl("https://xyzcompany.supabase.co")
    ).toThrow(/non-local/i)
    expect(() =>
      validateLocalSupabaseUrl("http://192.168.1.10:54421")
    ).toThrow(/non-local/i)
    expect(validateLocalSupabaseUrl("http://127.0.0.1:54421")).toBe(
      "http://127.0.0.1:54421"
    )
    expect(validateLocalSupabaseUrl("http://localhost:54421")).toBe(
      "http://localhost:54421"
    )
  })

  it("passes only allowlisted env to the ERP server", () => {
    const stdout = [
      'API_URL="http://127.0.0.1:54421"',
      'ANON_KEY="anon-short"',
      'SERVICE_ROLE_KEY="srv-short"',
    ].join("\n")

    const parentEnv = {
      PATH: "/usr/bin",
      HOME: "/Users/test",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      OPENROUTER_API_KEY: "or-short",
      OPENROUTER_MODEL: "openai/gpt-4o-mini",
      CRON_SECRET: "drop-me",
      RESEND_API_KEY: "drop-resend",
      EMAIL_FROM: "noreply@example.com",
      N8N_WEBHOOK_SECRET: "drop-n8n",
      DATABASE_URL: "postgresql://localhost/drop",
    }

    const env = mapStatusEnvToServerEnv(stdout, 3989, parentEnv)
    expect(Object.keys(env).sort()).toEqual(
      [
        "HOME",
        "LANG",
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NODE_ENV",
        "OPENROUTER_API_KEY",
        "OPENROUTER_MODEL",
        "PATH",
        "SUPABASE_SERVICE_ROLE_KEY",
        "TMPDIR",
      ].sort()
    )
    expect(env.CRON_SECRET).toBeUndefined()
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.EMAIL_FROM).toBeUndefined()
    expect(env.N8N_WEBHOOK_SECRET).toBeUndefined()
  })

  it("exits 3 with a clear message when Docker is not running", async () => {
    const erpDir = makeTempErpDir(true)
    let errText = ""
    const stderr = {
      write(chunk: string) {
        errText += chunk
      },
    }
    const runner = {
      async exec(cmd: string) {
        if (cmd === "docker") {
          return { code: 1, stdout: "", stderr: "Cannot connect to daemon" }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    const code = await runUp({ erpDir, runner, stderr })
    expect(code).toBe(3)
    expect(errText).toMatch(/Docker/i)
  })

  it("builds from a clean export of HEAD with no .env files", async () => {
    const erpDir = makeTempErpDir(true)
    const cacheDir = makeTempErpDir(false)
    const sha = "a".repeat(40)
    const buildEnvs: Array<Record<string, string | undefined>> = []
    let archivedWithGit = false
    let envExistedDuringBuild = false

    const runner = {
      async exec(
        cmd: string,
        args: string[],
        opts: { cwd?: string; env?: Record<string, string | undefined> } = {}
      ) {
        if (cmd === "git" && args.includes("rev-parse")) {
          return { code: 0, stdout: `${sha}\n`, stderr: "" }
        }
        if (cmd === "git" && args.includes("archive")) {
          archivedWithGit = true
          const outIdx = args.indexOf("-o")
          writeFileSync(args[outIdx + 1], "fake-tar")
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "tar") {
          const dirIdx = args.indexOf("-C")
          const target = args[dirIdx + 1]
          writeFileSync(path.join(target, "package.json"), "{}")
          writeFileSync(path.join(target, ".env.local"), "LEAK=1")
          writeFileSync(path.join(target, ".env"), "LEAK=2")
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "pnpm") {
          buildEnvs.push(opts.env ?? {})
          return { code: 0, stdout: "", stderr: "" }
        }
        if (args.includes("build")) {
          buildEnvs.push(opts.env ?? {})
          if (opts.cwd) {
            envExistedDuringBuild =
              existsSync(path.join(opts.cwd, ".env")) ||
              existsSync(path.join(opts.cwd, ".env.local"))
            mkdirSync(path.join(opts.cwd, ".next"), { recursive: true })
            writeFileSync(path.join(opts.cwd, ".next", "BUILD_ID"), "b1")
          }
          return { code: 0, stdout: "", stderr: "" }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    const res = await prepareCachedBuild({
      erpDir,
      cacheDir,
      runner,
      parentEnv: {
        PATH: "/usr/bin",
        NEXT_PUBLIC_SUPABASE_URL: "https://should-not-leak.supabase.co",
      },
      stderr: { write() {} },
    })

    expect(archivedWithGit).toBe(true)
    expect(envExistedDuringBuild).toBe(false)
    expect(existsSync(path.join(res.buildDir, ".env.local"))).toBe(false)
    for (const env of buildEnvs) {
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined()
    }
  })

  it("always passes --workdir and refuses a dir without the boombignose-erp config", async () => {
    const emptyDir = makeTempErpDir(false)
    expect(() => verifyErpWorkdir(emptyDir)).toThrow(/boombignose-erp/)

    const wrongDir = makeTempErpDir(false)
    mkdirSync(path.join(wrongDir, "supabase"), { recursive: true })
    writeFileSync(
      path.join(wrongDir, "supabase", "config.toml"),
      'project_id = "other-project"\n'
    )
    expect(() => verifyErpWorkdir(wrongDir)).toThrow(/boombignose-erp/)

    const validDir = makeTempErpDir(true)
    const seenArgs: string[][] = []
    const runner = {
      async exec(_cmd: string, args: string[]) {
        seenArgs.push(args)
        return { code: 0, stdout: "2.120.0\n", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    await runSupabase(runner, validDir, ["--version"])
    expect(seenArgs[0]).toEqual(["--version", "--workdir", validDir])
  })

  it("never stops all projects", async () => {
    const erpDir = makeTempErpDir(true)
    expect(() =>
      assertSafeSupabaseArgs(["stop", "--all", "--workdir", erpDir])
    ).toThrow(/forbidden/i)
    await expect(
      runSupabase(
        {
          async exec() {
            return { code: 0, stdout: "", stderr: "" }
          },
          spawn() {
            throw new Error("unexpected")
          },
        },
        erpDir,
        ["stop", "--all"]
      )
    ).rejects.toThrow(/forbidden/i)
  })

  it("doctor reports exposed when a stack port is bound to 0.0.0.0", async () => {
    const erpDir = makeTempErpDir(true)
    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "docker" && args[0] === "info") {
          return { code: 0, stdout: "ok", stderr: "" }
        }
        if (cmd === "docker" && args[0] === "ps") {
          return {
            code: 0,
            stdout: [
              "supabase_db_boombignose-erp\t0.0.0.0:54422->5432/tcp\tUp 5 minutes",
              "supabase_kong_boombignose-erp\t0.0.0.0:54421->8000/tcp\tUp 5 minutes",
            ].join("\n"),
            stderr: "",
          }
        }
        if (args.includes("--version")) {
          return {
            code: 0,
            stdout: "2.120.0\n",
            stderr: "A new version of Supabase CLI is available\n",
          }
        }
        if (args.includes("status")) {
          return {
            code: 0,
            stdout: [
              'API_URL="http://127.0.0.1:54421"',
              'ANON_KEY="anon-short"',
              'SERVICE_ROLE_KEY="srv-short"',
            ].join("\n"),
            stderr: "",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected")
      },
    }

    const doc = await runDoctor({ erpDir, runner })
    expect(doc).toEqual({
      docker: "running",
      cli: "2.120.0",
      stack: "running",
      exposed: true,
    })
    expect(JSON.stringify(doc)).not.toContain("anon-short")
    expect(JSON.stringify(doc)).not.toContain("srv-short")
  })

  it("falls back to the last good build when a rebuild fails", async () => {
    const erpDir = makeTempErpDir(true)
    const cacheDir = makeTempErpDir(false)
    const goodSha = "1".repeat(40)
    const badSha = "2".repeat(40)

    const goodDir = path.join(cacheDir, goodSha, ".next")
    mkdirSync(goodDir, { recursive: true })
    writeFileSync(path.join(goodDir, "BUILD_ID"), "good-build")
    writeFileSync(path.join(cacheDir, "last-good"), `${goodSha}\n`)

    let errLog = ""
    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "git" && args.includes("rev-parse")) {
          return { code: 0, stdout: `${badSha}\n`, stderr: "" }
        }
        if (cmd === "git" && args.includes("archive")) {
          const outIdx = args.indexOf("-o")
          writeFileSync(args[outIdx + 1], "fake-tar")
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "tar") {
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "pnpm") {
          return { code: 0, stdout: "", stderr: "" }
        }
        if (args.includes("build")) {
          return {
            code: 1,
            stdout: "",
            stderr: "next/font/google network failure",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected")
      },
    }

    const res = await prepareCachedBuild({
      erpDir,
      cacheDir,
      runner,
      parentEnv: { PATH: "/usr/bin" },
      stderr: {
        write(s: string) {
          errLog += s
        },
      },
    })

    expect(res.fellBack).toBe(true)
    expect(res.sha).toBe(goodSha)
    expect(res.buildDir).toBe(path.join(cacheDir, goodSha))
    expect(errLog).toMatch(/falling back to last good build/i)
  })

  it("serve exits when its parent process dies", async () => {
    const erpDir = makeTempErpDir(true)
    const cacheDir = makeTempErpDir(false)
    const sha = "3".repeat(40)
    mkdirSync(path.join(cacheDir, sha, ".next"), { recursive: true })
    writeFileSync(path.join(cacheDir, sha, ".next", "BUILD_ID"), "b3")

    let parentAlive = true
    let killedWith: string | null = null
    const fakeChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: (sig?: string) => boolean
    }
    fakeChild.stdout = new EventEmitter()
    fakeChild.stderr = new EventEmitter()
    fakeChild.kill = (sig = "SIGTERM") => {
      killedWith = sig
      fakeChild.emit("exit", 0, sig)
      return true
    }

    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "git" && args.includes("rev-parse")) {
          return { code: 0, stdout: `${sha}\n`, stderr: "" }
        }
        if (args.includes("status")) {
          return {
            code: 0,
            stdout: [
              'API_URL="http://127.0.0.1:54421"',
              'ANON_KEY="anon-short"',
              'SERVICE_ROLE_KEY="srv-short"',
            ].join("\n"),
            stderr: "",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        setTimeout(() => {
          parentAlive = false
        }, 30)
        return fakeChild
      },
    }

    const code = await runServe({
      erpDir,
      cacheDir,
      port: 3991,
      runner,
      checkPort: async () => true,
      probeLogin: async () => true,
      isParentAlive: () => parentAlive,
      parentWatchIntervalMs: 10,
      stdout: { write() {} },
      stderr: { write() {} },
    })

    expect(killedWith).toBe("SIGTERM")
    expect(code).toBe(0)
  })

  it("a busy port gives a clear message", async () => {
    const erpDir = makeTempErpDir(true)
    let errText = ""
    const code = await runServe({
      erpDir,
      port: 3992,
      checkPort: async () => false,
      stderr: {
        write(s: string) {
          errText += s
        },
      },
    })

    expect(code).toBe(1)
    expect(errText).toContain("3992")
    expect(errText).toMatch(/already in use|busy/i)
  })
})
