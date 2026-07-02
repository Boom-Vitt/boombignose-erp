import { describe, it, expect } from "vitest"

import { actionLabel, actorName, auditSentence, relativeTime } from "./format"

describe("actorName", () => {
  it("returns the email when present", () => {
    expect(actorName("owner@studio.co")).toBe("owner@studio.co")
  })

  it("trims surrounding whitespace", () => {
    expect(actorName("  dana@studio.co  ")).toBe("dana@studio.co")
  })

  it("falls back to 'System' when the actor is null", () => {
    expect(actorName(null)).toBe("System")
  })

  it("falls back to 'System' when the actor is undefined", () => {
    expect(actorName(undefined)).toBe("System")
  })

  it("falls back to 'System' for an empty / whitespace email", () => {
    expect(actorName("")).toBe("System")
    expect(actorName("   ")).toBe("System")
  })
})

describe("actionLabel", () => {
  it("maps known actions to friendly past-tense labels", () => {
    expect(actionLabel("created")).toBe("Created")
    expect(actionLabel("updated")).toBe("Updated")
    expect(actionLabel("deleted")).toBe("Deleted")
    expect(actionLabel("stage_changed")).toBe("Stage changed")
    expect(actionLabel("payment_recorded")).toBe("Payment recorded")
  })

  it("humanizes unknown snake_case actions instead of throwing", () => {
    expect(actionLabel("invoice_sent")).toBe("Invoice sent")
  })

  it("returns 'Activity' for an empty action", () => {
    expect(actionLabel("")).toBe("Activity")
  })
})

describe("auditSentence", () => {
  it("formats a create event with the actor and summary", () => {
    expect(
      auditSentence({
        actorEmail: "owner@studio.co",
        action: "created",
        entity: "deal",
        summary: 'Created deal "Acme website"',
      })
    ).toBe('owner@studio.co Created deal "Acme website"')
  })

  it("formats an update event", () => {
    expect(
      auditSentence({
        actorEmail: "dana@studio.co",
        action: "updated",
        entity: "settings",
        summary: "Updated workspace settings",
      })
    ).toBe("dana@studio.co Updated workspace settings")
  })

  it("formats a delete event", () => {
    expect(
      auditSentence({
        actorEmail: "owner@studio.co",
        action: "deleted",
        entity: "deal",
        summary: 'Deleted deal "Acme website"',
      })
    ).toBe('owner@studio.co Deleted deal "Acme website"')
  })

  it("formats a stage_changed event with an old → new transition summary", () => {
    expect(
      auditSentence({
        actorEmail: "owner@studio.co",
        action: "stage_changed",
        entity: "deal",
        summary: 'Moved deal "Acme" from proposal → won',
      })
    ).toBe('owner@studio.co Moved deal "Acme" from proposal → won')
  })

  it("formats a payment_recorded event", () => {
    expect(
      auditSentence({
        actorEmail: "owner@studio.co",
        action: "payment_recorded",
        entity: "payment",
        summary: "Recorded ฿12,000 payment on invoice INV-001",
      })
    ).toBe("owner@studio.co Recorded ฿12,000 payment on invoice INV-001")
  })

  it("uses 'System' when the actor is null", () => {
    expect(
      auditSentence({
        actorEmail: null,
        action: "created",
        entity: "deal",
        summary: 'Created deal "Acme"',
      })
    ).toBe('System Created deal "Acme"')
  })

  it("falls back to a generated sentence when no summary is supplied", () => {
    // entity + action label, prefixed by actor — for legacy/partial rows.
    expect(
      auditSentence({
        actorEmail: "owner@studio.co",
        action: "created",
        entity: "invoice",
      })
    ).toBe("owner@studio.co Created invoice")
  })

  it("trims a padded summary", () => {
    expect(
      auditSentence({
        actorEmail: null,
        action: "updated",
        entity: "settings",
        summary: "   Updated workspace settings   ",
      })
    ).toBe("System Updated workspace settings")
  })
})

describe("relativeTime", () => {
  const now = new Date("2026-06-30T12:00:00Z")

  it("renders 'just now' for the current instant", () => {
    expect(relativeTime("2026-06-30T11:59:40Z", now)).toBe("just now")
  })

  it("renders minutes ago", () => {
    expect(relativeTime("2026-06-30T11:45:00Z", now)).toBe("15 minutes ago")
    expect(relativeTime("2026-06-30T11:59:00Z", now)).toBe("1 minute ago")
  })

  it("renders hours ago", () => {
    expect(relativeTime("2026-06-30T09:00:00Z", now)).toBe("3 hours ago")
    expect(relativeTime("2026-06-30T11:00:00Z", now)).toBe("1 hour ago")
  })

  it("renders days ago", () => {
    expect(relativeTime("2026-06-28T12:00:00Z", now)).toBe("2 days ago")
    expect(relativeTime("2026-06-29T12:00:00Z", now)).toBe("1 day ago")
  })

  it("renders an absolute date for older events", () => {
    // Beyond 7 days we show an absolute Bangkok-local date.
    const out = relativeTime("2026-05-01T12:00:00Z", now)
    expect(out).toMatch(/2026/)
    expect(out).not.toMatch(/ago/)
  })

  it("returns an empty string for an unparseable timestamp", () => {
    expect(relativeTime("not-a-date", now)).toBe("")
  })
})
