/**
 * Auto-numbering for documents (quotes/invoices).
 *
 * Numbers follow the shape `PREFIX-YEAR-NNN`, e.g. `INV-2026-007`, where NNN is a
 * per-year running counter zero-padded to at least three digits. Numbering is a
 * pure function of the existing numbers so it can be unit-tested and called from
 * server actions after loading the org's current numbers.
 */

/** Zero-pad a positive integer to at least three digits. 1 → "001", 1000 → "1000". */
function padCounter(n: number): string {
  return String(n).padStart(3, "0")
}

/**
 * Compute the next document number for a given prefix and year.
 *
 * Scans `existingNumbers` for entries matching `^{prefix}-{year}-(\d+)$`, takes the
 * highest counter, adds one, and zero-pads to three digits. Entries that don't match
 * the prefix/year shape (different prefix, different year, free-form text) are ignored.
 * When nothing matches, numbering starts at 1 → `PREFIX-YEAR-001`.
 *
 * @example nextDocumentNumber("INV", ["INV-2026-006"], 2026) // "INV-2026-007"
 * @example nextDocumentNumber("QUO", [], 2026)               // "QUO-2026-001"
 */
export function nextDocumentNumber(
  prefix: string,
  existingNumbers: string[],
  year: number
): string {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`)

  let max = 0
  for (const raw of existingNumbers) {
    const match = pattern.exec(raw.trim())
    if (!match) continue
    const counter = Number(match[1])
    if (Number.isFinite(counter) && counter > max) max = counter
  }

  return `${prefix}-${year}-${padCounter(max + 1)}`
}
