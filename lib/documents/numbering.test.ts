import { describe, it, expect } from "vitest"

import { nextDocumentNumber } from "./numbering"

describe("nextDocumentNumber", () => {
  it("starts at 001 when there are no existing numbers", () => {
    expect(nextDocumentNumber("INV", [], 2026)).toBe("INV-2026-001")
    expect(nextDocumentNumber("QUO", [], 2026)).toBe("QUO-2026-001")
  })

  it("increments from the highest matching counter", () => {
    expect(
      nextDocumentNumber("INV", ["INV-2026-001", "INV-2026-006"], 2026)
    ).toBe("INV-2026-007")
  })

  it("takes the max even when the list is out of order or has gaps", () => {
    expect(
      nextDocumentNumber("INV", ["INV-2026-010", "INV-2026-003", "INV-2026-007"], 2026)
    ).toBe("INV-2026-011")
  })

  it("ignores non-matching entries (wrong prefix, wrong year, free-form)", () => {
    expect(
      nextDocumentNumber(
        "INV",
        [
          "QUO-2026-050", // wrong prefix
          "INV-2025-099", // wrong year
          "INV-2026", // no counter
          "random text",
          "INV-2026-004",
        ],
        2026
      )
    ).toBe("INV-2026-005")
  })

  it("scopes counting to the requested year", () => {
    const numbers = ["INV-2025-020", "INV-2026-002"]
    expect(nextDocumentNumber("INV", numbers, 2025)).toBe("INV-2025-021")
    expect(nextDocumentNumber("INV", numbers, 2026)).toBe("INV-2026-003")
    expect(nextDocumentNumber("INV", numbers, 2027)).toBe("INV-2027-001")
  })

  it("pads to three digits but grows past 999 without truncating", () => {
    expect(nextDocumentNumber("INV", ["INV-2026-008"], 2026)).toBe("INV-2026-009")
    expect(nextDocumentNumber("INV", ["INV-2026-099"], 2026)).toBe("INV-2026-100")
    expect(nextDocumentNumber("INV", ["INV-2026-999"], 2026)).toBe("INV-2026-1000")
  })

  it("tolerates surrounding whitespace on stored numbers", () => {
    expect(nextDocumentNumber("INV", ["  INV-2026-002  "], 2026)).toBe("INV-2026-003")
  })
})
