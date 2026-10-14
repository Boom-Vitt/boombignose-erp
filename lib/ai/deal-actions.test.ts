import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { createClient, generateText } = vi.hoisted(() => ({
  createClient: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "org-1", userId: "user-1" }),
}))
vi.mock("@/lib/ai/client", () => ({
  generateText,
  DEFAULT_MODEL: "test/model",
  isAIConfigured: () => true,
  AINotConfiguredError: class extends Error {},
}))

import { draftFollowup, summarizeDeal } from "@/app/(app)/deals/ai-actions"

// Real seed-style id: valid GUID shape, but no RFC version/variant bits.
const SEED_ID = "d0000000-0000-0000-0000-000000000007"

// Supabase query-builder fake: every chain resolves to "no row".
const emptyClient = () => {
  const q: Record<string, unknown> = {}
  for (const m of ["from", "select", "eq", "order", "limit", "insert"]) q[m] = () => q
  q.maybeSingle = async () => ({ data: null })
  return q
}

const actions = [
  ["summarizeDeal", summarizeDeal],
  ["draftFollowup", draftFollowup],
] as const

describe.each(actions)("%s", (_name, action) => {
  beforeEach(() => {
    createClient.mockReset()
    generateText.mockReset()
    createClient.mockResolvedValue(emptyClient())
  })

  it("deal AI actions accept a seeded demo deal id", async () => {
    // Passes validation and reaches the (mocked, empty) lookup.
    expect(await action(SEED_ID)).toEqual({ error: "Deal not found." })
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(generateText).not.toHaveBeenCalled()
  })

  it("deal AI actions still reject a malformed deal id", async () => {
    expect(await action("not-a-uuid")).toEqual({ error: "Invalid deal." })
    expect(createClient).not.toHaveBeenCalled()
  })
})
