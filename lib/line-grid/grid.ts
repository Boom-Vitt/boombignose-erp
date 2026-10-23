import { sumSatang } from "@/lib/money"
import { calculateTax, type TaxTotals } from "@/lib/tax/totals"
import { serviceAmountBaht, serviceAmountSatang, serviceLineAmount } from "@/lib/workflows/service"

/**
 * Client draft of a document's lines (quote, invoice, purchase order), Odoo x2many style:
 * edit every row locally, preview totals with the server's tax function, then save once.
 * Rows keep stable ids; new rows get a client UUID so a retried save never duplicates them.
 */
export type DocumentKind = "quote" | "invoice" | "purchase_order"

export type PricedLine = {
  kind: "line"
  id: string
  productId: string | null
  description: string
  quantity: string
  unit: string
  unitPrice: string
  taxRateBps: number
  /** Read-only per-line facts the page shows beside the editable cells (invoiced, received...). */
  extras?: string[]
}
export type TextRow = { kind: "section" | "note"; id: string; description: string }
export type GridRow = PricedLine | TextRow
export type RowKind = GridRow["kind"]

export type GridState = { saved: GridRow[]; rows: GridRow[] }
export type LineDefaults = { taxRateBps: number; unit: string }
type LinePatch = Partial<Pick<PricedLine, "productId" | "description" | "quantity" | "unit" | "unitPrice" | "taxRateBps">>

export type GridAction =
  | { type: "reset"; rows: GridRow[] }
  | { type: "discard" }
  | { type: "add"; kind: RowKind; id: string; defaults: LineDefaults; at?: number }
  | { type: "edit"; id: string; patch: LinePatch }
  | { type: "remove"; id: string }
  | { type: "move"; from: number; to: number }

export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case "reset": return { saved: action.rows, rows: action.rows }
    case "discard": return { ...state, rows: state.saved }
    case "add": {
      const row: GridRow = action.kind === "line"
        ? { kind: "line", id: action.id, productId: null, description: "", quantity: "1", unit: action.defaults.unit, unitPrice: "0.00", taxRateBps: action.defaults.taxRateBps }
        : { kind: action.kind, id: action.id, description: "" }
      const at = action.at ?? state.rows.length
      return { ...state, rows: [...state.rows.slice(0, at), row, ...state.rows.slice(at)] }
    }
    case "edit": return {
      ...state,
      rows: state.rows.map(row => row.id !== action.id ? row
        : row.kind === "line" ? { ...row, ...action.patch }
        : action.patch.description === undefined ? row : { ...row, description: action.patch.description }),
    }
    case "remove": return { ...state, rows: state.rows.filter(row => row.id !== action.id) }
    case "move": {
      const { from, to } = action
      if (from === to || from < 0 || to < 0 || from >= state.rows.length || to >= state.rows.length) return state
      const rows = [...state.rows]
      const [moved] = rows.splice(from, 1)
      rows.splice(to, 0, moved)
      return { ...state, rows }
    }
  }
}

export function isDirty(state: GridState) {
  return JSON.stringify(state.rows) !== JSON.stringify(state.saved)
}

export type RowIssues = Partial<Record<"description" | "quantity" | "unit" | "unitPrice", string>>

/** Purchase lines need a unit; quote and invoice lines may leave it blank, as older lines do. */
export function rowIssues(row: GridRow, unitRequired = false): RowIssues {
  const issues: RowIssues = {}
  const description = row.description.trim()
  if (!description) issues.description = "Description is required"
  else if (description.length > 4000) issues.description = "Keep the description under 4,000 characters"
  if (row.kind !== "line") return issues
  try { serviceLineAmount(row.quantity, 0) } catch { issues.quantity = "Positive quantity, up to three decimals" }
  const unit = row.unit.trim()
  if (unit.length > 40) issues.unit = "Keep the unit under 40 characters"
  else if (unitRequired && !unit) issues.unit = "Unit is required"
  try {
    const price = serviceAmountSatang(row.unitPrice)
    if (!issues.quantity) serviceLineAmount(row.quantity, price)
  } catch { issues.unitPrice = "Exact THB amount, up to two decimals" }
  return issues
}

/** The line amount the server's line guard will store, or null while the row is invalid. */
export function lineAmount(row: PricedLine): number | null {
  try { return serviceLineAmount(row.quantity, serviceAmountSatang(row.unitPrice)) } catch { return null }
}

export type TotalsBasis = { discountSatang: number; pricesIncludeVat: boolean; whtRateBps: number }

/**
 * Same tax function the server mirrors (document_tax_totals). Invalid rows are left out of the
 * preview. A draft discount above the subtotal is clamped, exactly as the SQL helper does for drafts.
 */
export function gridTotals(rows: GridRow[], basis: TotalsBasis): TaxTotals {
  const lines = rows.flatMap(row => {
    if (row.kind !== "line") return []
    const amount = lineAmount(row)
    return amount === null ? [] : [{ amount_satang: amount, tax_rate_bps: row.taxRateBps }]
  })
  const subtotal = sumSatang(lines.map(line => line.amount_satang))
  return calculateTax(lines, Math.min(basis.discountSatang, subtotal), basis.pricesIncludeVat, basis.whtRateBps)
}

/** A purchase order has no tax: its total is the sum of the valid line amounts. */
export function untaxedTotal(rows: GridRow[]): number {
  return sumSatang(rows.flatMap(row => row.kind === "line" ? [lineAmount(row) ?? 0] : []))
}

export type PayloadRow =
  | { kind: "line"; id: string; product_id: string | null; description: string; quantity: string; unit: string | null; unit_price_satang: number; tax_rate_bps: number }
  | { kind: "section" | "note"; id: string; description: string }

/** A new row the user never filled in, like Odoo's untouched new line, is dropped instead of blocking Save. */
function untouched(row: GridRow, savedIds: Set<string>) {
  return !savedIds.has(row.id) && !row.description.trim() && (row.kind !== "line" || row.productId === null)
}

/** Rows to save in display order, plus the saved rows the user removed. Call only when no row has issues. */
export function savePayload(state: GridState): { rows: PayloadRow[]; deleted: string[] } {
  const savedIds = new Set(state.saved.map(row => row.id))
  const kept = state.rows.filter(row => !untouched(row, savedIds))
  const keptIds = new Set(kept.map(row => row.id))
  return {
    rows: kept.map(row => row.kind === "line"
      ? { kind: "line", id: row.id, product_id: row.productId, description: row.description.trim(), quantity: row.quantity.trim(), unit: row.unit.trim() || null, unit_price_satang: serviceAmountSatang(row.unitPrice), tax_rate_bps: row.taxRateBps }
      : { kind: row.kind, id: row.id, description: row.description.trim() }),
    deleted: state.saved.filter(row => !keptIds.has(row.id)).map(row => row.id),
  }
}

/** Rows that would block Save; untouched new rows are skipped because Save drops them. */
export function blockingIssues(state: GridState, unitRequired = false): Map<string, RowIssues> {
  const savedIds = new Set(state.saved.map(row => row.id))
  return new Map(state.rows.filter(row => !untouched(row, savedIds))
    .map(row => [row.id, rowIssues(row, unitRequired)] as const)
    .filter(([, issues]) => Object.keys(issues).length > 0))
}

export type ServerLine = { id: string; product_id: string | null; description: string; quantity: number; unit: string | null; unit_price_satang: number; tax_rate_bps?: number; extras?: string[] }
export type ServerSection = { id: string; kind: string; description: string; lines_before: number; position: number }

/** Places each section before the priced line it precedes; trailing sections follow the last line. */
export function interleave<L, S extends Pick<ServerSection, "lines_before" | "position">>(lines: L[], sections: S[]): (L | S)[] {
  const sorted = [...sections].sort((a, b) => a.lines_before - b.lines_before || a.position - b.position)
  const result: (L | S)[] = []
  let next = 0
  lines.forEach((line, index) => {
    while (next < sorted.length && sorted[next].lines_before <= index) result.push(sorted[next++])
    result.push(line)
  })
  return [...result, ...sorted.slice(next)]
}

export function toGridRows(lines: ServerLine[], sections: ServerSection[]): GridRow[] {
  return interleave(lines, sections).map((row): GridRow => "lines_before" in row
    ? { kind: row.kind === "note" ? "note" : "section", id: row.id, description: row.description }
    : {
      kind: "line", id: row.id, productId: row.product_id, description: row.description,
      quantity: String(Number(row.quantity)), unit: row.unit ?? "", unitPrice: serviceAmountBaht(row.unit_price_satang),
      taxRateBps: row.tax_rate_bps ?? 0, ...(row.extras ? { extras: row.extras } : {}),
    })
}

/** Spreadsheet Enter: same column one row down (up with Shift); past the last row it asks for a new line. */
export function enterTarget(rows: GridRow[], index: number, column: string, shift: boolean, columns: (row: GridRow) => string[]): { index: number; column: string } | "add" | null {
  const target = index + (shift ? -1 : 1)
  if (target < 0) return null
  if (target >= rows.length) return shift ? null : "add"
  const available = columns(rows[target])
  return { index: target, column: available.includes(column) ? column : "description" }
}

/** Read-only per-line columns each document shows beside the editable cells. */
export const EXTRA_HEADERS: Record<DocumentKind, string[]> = { quote: ["Invoiced"], invoice: [], purchase_order: ["Received", "Returned", "Billed"] }
