import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, writeFile, symlink } from "node:fs/promises"
import { resolve } from "node:path"
import net from "node:net"

const lane = Number(process.argv[2])
if (!Number.isInteger(lane) || lane < 1 || lane > 6) throw new Error("Use lane 1..6")
const root = await realpath(process.cwd())
const base = 55000 + lane * 100
const app = 3100 + lane
const project = `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}`
const ports = [app, base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 8, base + 9]
for (const port of ports) {
  await new Promise((done, fail) => {
    const server = net.createServer()
    server.once("error", fail)
    server.listen(port, "127.0.0.1", () => server.close(done))
  })
}
const runtime = resolve(root, ".local-stack")
await mkdir(resolve(runtime, "supabase"), { recursive: true })
let config = await readFile("supabase/config.toml", "utf8")
config = config.replace(/project_id = ".*"/, `project_id = "${project}"`)
for (const [old, offset] of [[54420, 0], [54421, 1], [54422, 2], [54423, 3], [54424, 4], [54427, 7], [8083, 8], [54429, 9]]) {
  config = config.replace(new RegExp(`= ${old}\\b`, "g"), `= ${base + offset}`)
}
config = config.replace(/site_url = ".*"/, `site_url = "http://127.0.0.1:${app}"`)
config = config.replace(/additional_redirect_urls = \[.*\]/, `additional_redirect_urls = ["http://127.0.0.1:${app}/auth/confirm"]`)
await writeFile(resolve(runtime, "supabase/config.toml"), config)
for (const name of ["migrations", "seed.sql", "tests"]) {
  try { await symlink(resolve(root, "supabase", name), resolve(runtime, "supabase", name)) }
  catch (error) { if (error.code !== "EEXIST") throw error }
}
await writeFile(resolve(runtime, "isolation.json"), JSON.stringify({ root, project, app, api: base + 1, db: base + 2 }, null, 2))
console.log(`Isolated ${project}: app ${app}, API ${base + 1}, DB ${base + 2}; runtime ${runtime}`)
