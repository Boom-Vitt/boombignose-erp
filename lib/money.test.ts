import { describe, it, expect } from "vitest"

import {
  bahtToSatang,
  satangToBaht,
  sumSatang,
  formatTHB,
  formatTHBWhole,
  formatTHBCompact,
} from "@/lib/money"

describe("money conversions", () => {
  it("converts baht to integer satang", () => {
    expect(bahtToSatang(123.45)).toBe(12345)
    expect(bahtToSatang(1)).toBe(100)
    expect(bahtToSatang(0)).toBe(0)
  })

  it("rounds fractional satang to the nearest integer", () => {
    expect(bahtToSatang(0.005)).toBe(1)
    expect(bahtToSatang(10.999)).toBe(1100)
  })

  it("converts satang back to baht", () => {
    expect(satangToBaht(12345)).toBeCloseTo(123.45, 5)
  })

  it("sums satang exactly with no float drift", () => {
    expect(sumSatang([100, 250, 50])).toBe(400)
    expect(sumSatang([])).toBe(0)
    // 0.1 + 0.2 baht problem does not exist in satang space:
    expect(sumSatang([10, 20])).toBe(30)
  })
})

describe("THB formatting", () => {
  it("formats with two decimals", () => {
    expect(formatTHB(123456)).toContain("1,234.56")
  })

  it("formats whole baht (no decimals)", () => {
    expect(formatTHBWhole(123456)).toContain("1,235")
  })

  it("returns a string for compact formatting", () => {
    expect(typeof formatTHBCompact(1_234_567_890)).toBe("string")
  })
})
