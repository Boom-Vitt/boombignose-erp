#!/usr/bin/env node
import { runCli } from "../../lib/local/stack.mjs"

const code = await runCli(process.argv.slice(2))
if (typeof code === "number" && code !== 0) {
  process.exit(code)
}
