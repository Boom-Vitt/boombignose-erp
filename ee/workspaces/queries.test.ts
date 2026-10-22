import { expect, it, vi } from "vitest"

vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "Unavailable" } }) }) }) }),
}) }))
import { getUserOrgs } from "./queries"

it("a failed workspace list cannot pretend there are no organizations", async () => {
  await expect(getUserOrgs()).rejects.toThrow("Unable to load workspace memberships")
})
