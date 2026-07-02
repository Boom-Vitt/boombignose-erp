/**
 * Pure text parsing for AI outputs. NO I/O, NO server-only imports — safe to
 * unit-test in a node environment with no API key and no network.
 */

export type ActionItem = { title: string }

/** A line is a "header" we skip: markdown heading (`#`), or a bold/label line
 * that ends with a colon and carries no real content (e.g. "Action Items:"). */
function isHeaderLine(line: string): boolean {
  if (line.startsWith("#")) return true
  // "Summary:", "**Action items:**", "Action Items:" — a short label line.
  const stripped = line.replace(/\*\*/g, "").trim()
  return /^[A-Za-z][A-Za-z0-9 ()/-]{0,40}:$/.test(stripped)
}

/** Strip a leading bullet/number marker from a line, returning the remainder,
 * or null when the line carries no such marker. */
function stripMarker(line: string): string | null {
  // Bullets: -, *, •, –, — (optionally after indentation, already trimmed).
  const bullet = line.match(/^[-*•–—]\s+(.*)$/)
  if (bullet) return bullet[1]
  // Numbered / lettered: "1.", "1)", "a.", "iv)" etc.
  const numbered = line.match(/^(?:\d{1,3}|[a-zA-Z])[.)]\s+(.*)$/)
  if (numbered) return numbered[1]
  // Checkbox bullets: "- [ ] task" would already be caught by the bullet rule,
  // leaving "[ ] task" — strip a leading empty checkbox if present.
  const checkbox = line.match(/^\[[ xX]?\]\s+(.*)$/)
  if (checkbox) return checkbox[1]
  return null
}

/** Remove a residual checkbox token (`[ ]`, `[x]`) left at the front of an
 * item after its bullet marker was stripped (e.g. "- [ ] Call client"). */
function stripCheckbox(text: string): string {
  return text.replace(/^\[[ xX]?\]\s*/, "")
}

/**
 * Extract bullet/numbered lines from model output into action items.
 * - Strips `-`, `*`, `•`, `1.`, `1)`, `a.` and checkbox prefixes.
 * - Skips blank lines and header/label lines.
 * - When the text contains NO bullets or numbered lines at all, returns [] —
 *   prose without a list yields no action items (callers show the summary).
 */
export function parseActionItems(modelText: string): ActionItem[] {
  if (!modelText) return []

  const items: ActionItem[] = []
  for (const raw of modelText.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "") continue
    if (isHeaderLine(line)) continue

    const body = stripMarker(line)
    if (body === null) continue // not a list line — ignore prose

    const title = stripCheckbox(body).trim()
    if (title === "") continue
    // Models are sometimes instructed to emit a "(none)" placeholder when there
    // are no real action items — treat that as no item, not a bullet reading
    // "(none)".
    if (/^\(?none\)?\.?$/i.test(title)) continue
    items.push({ title })
  }

  return items
}
