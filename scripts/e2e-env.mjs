import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { promisify } from "node:util"

const isolation = JSON.parse(await readFile(".local-stack/isolation.json", "utf8"))
const { stdout } = await promisify(execFile)(
  "pnpm",
  ["exec", "supabase", "status", "-o", "env", "--workdir", ".local-stack"],
  { encoding: "utf8" },
)
const env = {}
for (const line of stdout.split("\n")) {
  const index = line.indexOf("=")
  if (index < 1) continue
  let value = line.slice(index + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  env[line.slice(0, index)] = value
}
const api = `http://127.0.0.1:${isolation.api}`
if (env.API_URL !== api) throw new Error(`Local API_URL must be ${api}`)
if (!env.ANON_KEY || !env.SERVICE_ROLE_KEY) throw new Error("Local status did not return API keys")
const app = `http://127.0.0.1:${isolation.app}`
await writeFile(".env.local", [
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY}`,
  `NEXT_PUBLIC_APP_URL=${app}`,
  "",
].join("\n"), { mode: 0o600 })
console.log(`Wrote .env.local for app port ${isolation.app} and API port ${isolation.api}`)
