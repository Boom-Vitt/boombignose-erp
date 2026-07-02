import { describe, it, expect } from "vitest"

import {
  invoiceNumberFor,
  buildGeneratedInvoice,
  alreadyGeneratedForPeriod,
  isUniqueViolation,
  type GeneratableSubscription,
} from "./generate"

describe("invoiceNumberFor", () => {
  it("builds Name-YYYYMM", () => {
    expect(invoiceNumberFor("Acme Retainer", "2026-07-02")).toBe(
      "Acme Retainer-202607"
    )
  })
  it("zero-pads the month from the ISO date", () => {
    expect(invoiceNumberFor("Hosting", "2026-01-15")).toBe("Hosting-202601")
  })
})

const sub = (over: Partial<GeneratableSubscription> = {}): GeneratableSubscription => ({
  org_id: "org1",
  client_id: "client1",
  project_id: null,
  name: "Retainer",
  amount_satang: 500000,
  interval: "monthly",
  ...over,
})

describe("buildGeneratedInvoice", () => {
  it("emits a sent, recurring invoice dated today", () => {
    expect(buildGeneratedInvoice(sub(), "2026-07-02")).toEqual({
      org_id: "org1",
      client_id: "client1",
      project_id: null,
      number: "Retainer-202607",
      status: "sent",
      amount_satang: 500000,
      is_recurring: true,
      recurring_interval: "monthly",
      issue_date: "2026-07-02",
    })
  })
  it("carries the project id through when set", () => {
    expect(buildGeneratedInvoice(sub({ project_id: "proj1" }), "2026-07-02").project_id).toBe(
      "proj1"
    )
  })
})

describe("alreadyGeneratedForPeriod", () => {
  it("is true when the period's computed number is present", () => {
    expect(
      alreadyGeneratedForPeriod(["Retainer-202607"], "Retainer", "2026-07-02")
    ).toBe(true)
  })
  it("is false when only other periods/subs are present", () => {
    expect(
      alreadyGeneratedForPeriod(
        ["Retainer-202606", "Hosting-202607"],
        "Retainer",
        "2026-07-02"
      )
    ).toBe(false)
  })
  it("is false for an empty set", () => {
    expect(alreadyGeneratedForPeriod([], "Retainer", "2026-07-02")).toBe(false)
  })
  it("accepts any iterable of numbers (e.g. a Set)", () => {
    expect(
      alreadyGeneratedForPeriod(
        new Set(["Retainer-202607"]),
        "Retainer",
        "2026-07-02"
      )
    ).toBe(true)
  })
})

describe("isUniqueViolation", () => {
  it("is true for Postgres unique-violation code 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true)
  })
  it("is false for other codes and for null/undefined", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false)
    expect(isUniqueViolation({})).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})
