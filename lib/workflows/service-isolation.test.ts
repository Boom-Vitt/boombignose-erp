import { describe, expect, it } from "vitest"
import { assertServiceTestIsolation } from "./service-isolation.mjs"

const root = "/tmp/service-test-worktree"
// Golden project fingerprint from the existing worktree-env.mjs generator.
const fingerprint = "6cec93e52d"
function laneMetadata(lane: number) {
  return { root, project: `erp-${fingerprint}-${lane}`, app: 3100 + lane, api: 55001 + lane * 100, db: 55002 + lane * 100 }
}
function verify(metadata = laneMetadata(3), realRoot = root, api = `http://127.0.0.1:${metadata.api}`, configProject = metadata.project) {
  return assertServiceTestIsolation(metadata, realRoot, api, configProject)
}

describe("service API runner isolation", () => {
  it.each([1, 2, 3, 4, 5, 6])("accepts generated lane %i for this worktree", (lane) => {
    expect(() => verify(laneMetadata(lane))).not.toThrow()
  })
  it.each([0, 7, 3.5])("rejects unsupported lane %s", (lane) => {
    expect(() => verify(laneMetadata(lane))).toThrow()
  })
  it("rejects another worktree's metadata", () => {
    expect(() => verify(laneMetadata(3), "/tmp/another-worktree")).toThrow()
  })
  it("rejects a forged project fingerprint or stale generated config", () => {
    expect(() => verify({ ...laneMetadata(3), project: "erp-foreign-3" })).toThrow()
    expect(() => verify(laneMetadata(3), root, "http://127.0.0.1:55301", "erp-stale-3")).toThrow()
  })
  it("rejects arbitrary ports even with a matching environment URL", () => {
    expect(() => verify({ ...laneMetadata(3), api: 60001 })).toThrow()
    expect(() => verify({ ...laneMetadata(3), db: 60002 })).toThrow()
  })
  it.each(["https://example.invalid:55301", "http://localhost:55301", "http://127.0.0.1:55601", "http://127.0.0.1:55301/other"])("rejects nonmatching API URL %s", (url) => {
    expect(() => verify(laneMetadata(3), root, url)).toThrow()
  })
})
