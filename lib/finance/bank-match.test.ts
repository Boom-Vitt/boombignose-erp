import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { bankAmountSatang, suggestBankMatch, type BankCandidate } from "@/lib/finance/bank-match"

const receipt = (id: string, amount: number, reference: string | null, extra: Partial<BankCandidate> = {}): BankCandidate => ({
  id, amountSatang: amount, reference, verified: true, reversal: false, ...extra,
})

describe("suggestBankMatch", () => {
  it("matches one verified receipt with the same amount and reference", () => {
    const payments = [receipt("a", 104000, "OPS-RCPT-1"), receipt("b", 5000, "other")]
    expect(suggestBankMatch({ amountSatang: 104000, reference: " OPS-RCPT-1 " }, payments, new Set())).toBe("a")
  })

  it("does not guess when two receipts fit, and skips unverified, reversed, or already matched receipts", () => {
    const payments = [receipt("a", 100, "REF"), receipt("b", 100, "REF")]
    expect(suggestBankMatch({ amountSatang: 100, reference: "REF" }, payments, new Set())).toBeNull()
    expect(suggestBankMatch({ amountSatang: 100, reference: "REF" }, [receipt("a", 100, "REF", { verified: false })], new Set())).toBeNull()
    expect(suggestBankMatch({ amountSatang: -100, reference: "REF" }, [receipt("a", -100, "REF", { reversal: true })], new Set())).toBeNull()
    expect(suggestBankMatch({ amountSatang: 100, reference: "REF" }, [receipt("a", 100, "REF")], new Set(["a"]))).toBeNull()
    expect(suggestBankMatch({ amountSatang: 0, reference: "REF" }, [receipt("a", 0, "REF")], new Set())).toBeNull()
  })

  it("reads a signed baht amount", () => {
    expect(bankAmountSatang("1,040.00".replace(",", ""))).toBe(104000)
    expect(bankAmountSatang("-20.50")).toBe(-2050)
    expect(() => bankAmountSatang("0")).toThrow("non-zero")
  })

  it("keeps the database match on a verified receipt with the same amount and reference", () => {
    const sql = readFileSync("supabase/migrations/20261028120200_bank_lines.sql", "utf8")
    expect(sql).toContain("verification_state = 'verified'")
    expect(sql).toContain("reversal_of is null")
    expect(sql).toContain("amount_satang = line.amount_satang")
    expect(sql).toContain("btrim(coalesce(candidate.verification_reference, '')) = btrim(line.reference)")
  })
})
