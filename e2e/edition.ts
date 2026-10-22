import { loadEnvConfig } from "@next/env"

// Resolve BBN_EDITION as `next build` does for next.config.ts: Next's own .env loading (the shell wins), then community.
loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error })
const edition = process.env.BBN_EDITION ?? "community"
if (edition !== "community" && edition !== "pro") throw new Error(`BBN_EDITION must be community or pro, got ${JSON.stringify(edition)}`)
export const community = edition === "community"
