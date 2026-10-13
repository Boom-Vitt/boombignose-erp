import { describe, expect, it } from "vitest"
import { validateApiTestIsolation } from "./test-isolation.mjs"

const root = "/tmp/erp-portability"
const cases = [
  [1, 3101, 55101, 55102], [2, 3102, 55201, 55202],
  [3, 3103, 55301, 55302], [4, 3104, 55401, 55402],
  [5, 3105, 55501, 55502], [6, 3106, 55601, 55602],
] as const

function fixture(lane: number, app: number, api: number, db: number) {
  const project = `erp-12b03793c4-${lane}`
  return {
    actualRoot: root,
    metadata: { root, project, app, api, db },
    config: `project_id = "${project}"\n[api]\nport = ${api}\n[db]\nport = ${db}\n[auth]\nsite_url = "http://127.0.0.1:${app}"\n`,
    apiUrl: `http://127.0.0.1:${api}`,
  }
}

describe("portable local API test guard", () => {
  it.each(cases)("accepts verified generated lane %i", (lane, app, api, db) => {
    expect(validateApiTestIsolation(fixture(lane, app, api, db))).toEqual({ lane, app, api, db, project: `erp-12b03793c4-${lane}` })
  })
  it.each(["https://project.supabase.co", "http://127.0.0.1:55501/", "http://localhost:55501", "http://127.0.0.1:55601"])("rejects remote or mismatched endpoint %s", apiUrl => {
    expect(() => validateApiTestIsolation({ ...fixture(5, 3105, 55501, 55502), apiUrl })).toThrow()
  })
  it("rejects another checkout's metadata and project fingerprint", () => {
    const value = fixture(5, 3105, 55501, 55502)
    expect(() => validateApiTestIsolation({ ...value, actualRoot: "/tmp/other-checkout" })).toThrow()
    expect(() => validateApiTestIsolation({ ...value, metadata: { ...value.metadata, project: "erp-other-5" } })).toThrow()
  })
  it("rejects forged lane numbers and crossed port metadata", () => {
    expect(() => validateApiTestIsolation(fixture(0, 3100, 55001, 55002))).toThrow()
    expect(() => validateApiTestIsolation(fixture(7, 3107, 55701, 55702))).toThrow()
    const value = fixture(5, 3105, 55501, 55502)
    expect(() => validateApiTestIsolation({ ...value, metadata: { ...value.metadata, db: 55602 } })).toThrow()
  })
  it("rejects runtime config for another project, API, DB or auth app", () => {
    const value = fixture(5, 3105, 55501, 55502)
    for (const config of [value.config.replace("12b03793c4", "other"), value.config.replace("port = 55501", "port = 55601"), value.config.replace("port = 55502", "port = 55602"), value.config.replace(":3105", ":3106")]) {
      expect(() => validateApiTestIsolation({ ...value, config })).toThrow()
    }
  })
})
