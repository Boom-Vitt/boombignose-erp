import QRCode from "qrcode"

const AID = "A000000677010111"

function tlv(tag: string, value: string): string {
  return `${tag}${String(value.length).padStart(2, "0")}${value}`
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), the EMVCo tag 63 checksum. */
export function crc16CcittFalse(value: string): string {
  let crc = 0xffff
  for (let index = 0; index < value.length; index += 1) {
    crc ^= value.charCodeAt(index) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

function phoneProxy(phone: string): string | null {
  if (!/^0\d{9}$/.test(phone)) return null
  return `0066${phone.slice(1)}`
}

/**
 * Merchant-presented PromptPay credit-transfer payload. Built locally from the
 * identifier and amount. This is not a bank request and does not confirm payment.
 * `amountBaht` is a positive decimal with two digits, at most 13 characters.
 */
export function promptPayPayload(target: { taxId: string } | { phone: string }, amountBaht: string): string | null {
  if (!/^\d+\.\d{2}$/.test(amountBaht) || amountBaht.length > 13 || amountBaht === "0.00") return null
  const proxy = "taxId" in target
    ? (/^\d{13}$/.test(target.taxId) ? { tag: "02", value: target.taxId } : null)
    : (phoneProxy(target.phone) ? { tag: "01", value: phoneProxy(target.phone)! } : null)
  if (!proxy) return null
  const account = tlv("00", AID) + tlv(proxy.tag, proxy.value)
  const body = [
    tlv("00", "01"),
    tlv("01", "12"),
    tlv("29", account),
    tlv("58", "TH"),
    tlv("53", "764"),
    tlv("54", amountBaht),
    "6304",
  ].join("")
  return body + crc16CcittFalse(body)
}

export function bahtFromSatang(satang: number): string | null {
  if (!Number.isSafeInteger(satang) || satang <= 0) return null
  const amount = `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, "0")}`
  return amount.length <= 13 ? amount : null
}

/** Sync SVG. The payload is encoded as modules, not written into the markup. */
export function promptPaySvg(payload: string): string {
  const code = QRCode.create(payload, { errorCorrectionLevel: "M" })
  const size = code.modules.size
  let rects = ""
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (code.modules.get(x, y)) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="180" height="180" shape-rendering="crispEdges" role="img"><rect width="${size}" height="${size}" fill="#fff"/>${rects}</svg>`
}
