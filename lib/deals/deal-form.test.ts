import { expect, it, vi } from "vitest"

const watched = vi.hoisted(() => ({ values: ["proposal", 1000, "33.5"] as unknown[] }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("react-hook-form", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-hook-form")>(),
  useForm: () => ({ control: {}, setValue: vi.fn(), formState: { isSubmitting: false } }),
  useWatch: () => watched.values,
}))
vi.mock("@/components/record/record-guard", () => ({ useGuardedForm: () => vi.fn(), RecordFields: ({ children }: { children: unknown }) => children }))

import { DealForm } from "@/app/(app)/deals/_components/deal-form"

it("previews expected revenue while a decimal probability is being typed", () => {
  expect(() => DealForm({ clients: [], lostReasons: [], action: vi.fn() })).not.toThrow()
})
