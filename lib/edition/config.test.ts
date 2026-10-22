import { afterEach, expect, it, vi } from "vitest"

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
it("unconfigured installs select the Community module map", async () => {
  vi.stubEnv("BBN_EDITION", undefined)
  expect((await import("../../next.config")).default.typescript?.tsconfigPath).toBe("tsconfig.json")
})
it("licensed Pro builds select the Pro module map", async () => {
  vi.stubEnv("BBN_EDITION", "pro")
  expect((await import("../../next.config")).default.typescript?.tsconfigPath).toBe("tsconfig.pro.json")
})
it("an unknown edition cannot enable Pro accidentally", async () => {
  vi.stubEnv("BBN_EDITION", "enterprise-typo")
  await expect(import("../../next.config")).rejects.toThrow("BBN_EDITION must be community or pro")
})
