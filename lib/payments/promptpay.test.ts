import { describe, expect, it } from "vitest"
import { bahtFromSatang, crc16CcittFalse, promptPayPayload, promptPaySvg } from "./promptpay"

describe("PromptPay payload", () => {
  it("matches CRC-16/CCITT-FALSE on the catalogue check string", () => {
    expect(crc16CcittFalse("123456789")).toBe("29B1")
  })

  it("builds the published phone shape for 0812345678 and 100.00", () => {
    expect(promptPayPayload({ phone: "0812345678" }, "100.00")).toBe(
      "00020101021229370016A000000677010111011300668123456785802TH53037645406100.006304BB8A",
    )
  })

  it("builds a dynamic tax-ID payload for 1234567890123 and 1040.00", () => {
    expect(promptPayPayload({ taxId: "1234567890123" }, "1040.00")).toBe(
      "00020101021229370016A000000677010111021312345678901235802TH530376454071040.006304D1FF",
    )
  })

  it("rejects identifiers and amounts that are not a local credit transfer", () => {
    expect(promptPayPayload({ taxId: "123456789012" }, "10.00")).toBeNull()
    expect(promptPayPayload({ phone: "66812345678" }, "10.00")).toBeNull()
    expect(promptPayPayload({ taxId: "1234567890123" }, "0.00")).toBeNull()
    expect(promptPayPayload({ taxId: "1234567890123" }, "10")).toBeNull()
    expect(promptPayPayload({ taxId: "1234567890123" }, "10000000000.00")).toBeNull()
    expect(bahtFromSatang(104000)).toBe("1040.00")
    expect(bahtFromSatang(0)).toBeNull()
    expect(bahtFromSatang(-1)).toBeNull()
  })

  it("draws the payload as SVG modules without embedding the text or a remote address", () => {
    const payload = promptPayPayload({ taxId: "1234567890123" }, "1040.00")!
    const svg = promptPaySvg(payload)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain("<rect ")
    expect(svg).not.toContain(payload)
    expect(svg).not.toContain("https://")
    expect(svg).not.toContain("api.")
  })
})
