import type { NextConfig } from "next"

const edition = process.env.BBN_EDITION ?? "community"
if (edition !== "community" && edition !== "pro") throw new Error("BBN_EDITION must be community or pro")

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  typescript: { tsconfigPath: edition === "pro" ? "tsconfig.pro.json" : "tsconfig.json" },
  // Pin the workspace root to this project. A stray lockfile in a parent
  // directory can otherwise make Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
