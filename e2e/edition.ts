import { readFileSync } from "node:fs"

// Mirrors next.config.ts at build time: the shell value wins, then .env.local, then community.
const local = readFileSync(".env.local", "utf8").match(/^BBN_EDITION=(.*)$/m)?.[1]
export const community = (process.env.BBN_EDITION ?? local ?? "community") !== "pro"
