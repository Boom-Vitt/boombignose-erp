import { describe, expect, it } from "vitest"
import {
  blockingIssues, enterTarget, gridReducer, gridTotals, interleave, isDirty, lineAmount, rowIssues, savePayload, toGridRows, untaxedTotal,
  type GridRow, type GridState, type PricedLine,
} from "./grid"

const defaults = { taxRateBps: 700, unit: "piece" }
const line = (id: string, patch: Partial<PricedLine> = {}): PricedLine =>
  ({ kind: "line", id, productId: null, description: `Line ${id}`, quantity: "1", unit: "piece", unitPrice: "10.00", taxRateBps: 700, ...patch })
const section = (id: string, description = `Section ${id}`): GridRow => ({ kind: "section", id, description })
const loaded = (rows: GridRow[]): GridState => gridReducer({ saved: [], rows: [] }, { type: "reset", rows })
const ids = (state: GridState) => state.rows.map(row => row.id)

// The same rows and expectations as supabase/tests/line_grid.sql, so the preview and the server cannot drift.
const parityRows: GridRow[] = [
  line("a", { description: "Design", quantity: "1.5", unitPrice: "333.33" }),
  section("s", "Materials"),
  line("b", { description: "Boards", quantity: "2", unitPrice: "100.00", taxRateBps: 0 }),
  line("c", { description: "Glue", quantity: "0.333", unitPrice: "0.99" }),
  { kind: "note", id: "n", description: "Delivered on site" },
]

describe("line grid reducer", () => {
  it("adds a priced line with the document defaults at the end or after a row", () => {
    let state = loaded([line("a"), line("b")])
    state = gridReducer(state, { type: "add", kind: "line", id: "new", defaults })
    expect(state.rows.at(-1)).toEqual({ kind: "line", id: "new", productId: null, description: "", quantity: "1", unit: "piece", unitPrice: "0.00", taxRateBps: 700 })
    state = gridReducer(state, { type: "add", kind: "section", id: "sec", defaults, at: 1 })
    expect(ids(state)).toEqual(["a", "sec", "b", "new"])
    expect(state.rows[1]).toEqual({ kind: "section", id: "sec", description: "" })
  })

  it("edits one row; a section only takes text", () => {
    let state = loaded([line("a"), section("s")])
    state = gridReducer(state, { type: "edit", id: "a", patch: { quantity: "3", unitPrice: "2.50" } })
    state = gridReducer(state, { type: "edit", id: "s", patch: { description: "Phase 2", unitPrice: "9.00" } })
    expect(state.rows).toEqual([line("a", { quantity: "3", unitPrice: "2.50" }), section("s", "Phase 2")])
  })

  it("removes and reorders rows, ignoring moves out of range", () => {
    let state = loaded([line("a"), section("s"), line("b"), line("c")])
    state = gridReducer(state, { type: "move", from: 3, to: 0 })
    expect(ids(state)).toEqual(["c", "a", "s", "b"])
    expect(gridReducer(state, { type: "move", from: 0, to: 9 })).toBe(state)
    state = gridReducer(state, { type: "remove", id: "s" })
    expect(ids(state)).toEqual(["c", "a", "b"])
  })

  it("is dirty until discarded or reset to the server result", () => {
    const clean = loaded([line("a")])
    expect(isDirty(clean)).toBe(false)
    const edited = gridReducer(clean, { type: "edit", id: "a", patch: { description: "Changed" } })
    expect(isDirty(edited)).toBe(true)
    expect(isDirty(gridReducer(edited, { type: "discard" }))).toBe(false)
    const server = [line("a", { description: "Changed by server" })]
    expect(gridReducer(edited, { type: "reset", rows: server })).toEqual({ saved: server, rows: server })
  })
})

describe("line validation", () => {
  it("accepts a valid line and reports each invalid field", () => {
    expect(rowIssues(line("a"))).toEqual({})
    expect(rowIssues(line("a", { description: "  ", quantity: "0", unit: "x".repeat(41), unitPrice: "1.234" }))).toEqual({
      description: "Description is required",
      quantity: "Positive quantity, up to three decimals",
      unit: "Keep the unit under 40 characters",
      unitPrice: "Exact THB amount, up to two decimals",
    })
    expect(rowIssues(line("a", { quantity: "1.0005" })).quantity).toBeDefined()
    expect(rowIssues(line("a", { quantity: "999999999", unitPrice: "90071992547409.91" })).unitPrice).toBeDefined()
    expect(rowIssues(section("s", ""))).toEqual({ description: "Description is required" })
  })

  it("lets quote and invoice lines keep a blank unit, as older lines have, but not purchase lines", () => {
    expect(rowIssues(line("a", { unit: " " }))).toEqual({})
    expect(rowIssues(line("a", { unit: " " }), true)).toEqual({ unit: "Unit is required" })
    const state = loaded([line("a", { unit: "" })])
    expect(blockingIssues(state).size).toBe(0)
    expect([...blockingIssues(state, true).keys()]).toEqual(["a"])
    expect(savePayload(gridReducer(state, { type: "edit", id: "a", patch: { quantity: "2" } })).rows[0]).toMatchObject({ unit: null })
  })

  it("computes the amount the server's line guard stores, half up once", () => {
    expect(lineAmount(line("a", { quantity: "1.5", unitPrice: "333.33" }))).toBe(50000)
    expect(lineAmount(line("a", { quantity: "0.333", unitPrice: "0.99" }))).toBe(33)
    expect(lineAmount(line("a", { quantity: "abc" }))).toBeNull()
  })
})

describe("totals preview", () => {
  it("matches the server for exclusive VAT, a discount and 3% WHT", () => {
    expect(gridTotals(parityRows, { discountSatang: 1000, pricesIncludeVat: false, whtRateBps: 300 })).toEqual({
      subtotalSatang: 70033, discountSatang: 1000, baseSatang: 69033, vatSatang: 3452, totalSatang: 72485, whtSatang: 2071, amountDueSatang: 70414,
      vatByRate: [{ rateBps: 0, baseSatang: 19714, vatSatang: 0 }, { rateBps: 700, baseSatang: 49319, vatSatang: 3452 }],
    })
  })

  it("extracts inclusive VAT after the discount", () => {
    expect(gridTotals(parityRows, { discountSatang: 1000, pricesIncludeVat: true, whtRateBps: 0 })).toMatchObject({ baseSatang: 65807, vatSatang: 3226, totalSatang: 69033 })
  })

  it("clamps a draft discount above the subtotal as the server does, and skips invalid rows", () => {
    expect(gridTotals(parityRows, { discountSatang: 99_999_999, pricesIncludeVat: false, whtRateBps: 0 })).toMatchObject({ subtotalSatang: 70033, discountSatang: 70033, totalSatang: 0 })
    const withBroken = [...parityRows, line("x", { quantity: "-1" })]
    expect(gridTotals(withBroken, { discountSatang: 0, pricesIncludeVat: false, whtRateBps: 0 }).subtotalSatang).toBe(70033)
  })

  it("sums an untaxed purchase order", () => {
    expect(untaxedTotal([line("a", { quantity: "4", unitPrice: "12.34" }), section("s"), line("b", { quantity: "0" })])).toBe(4936)
  })
})

describe("save payload", () => {
  it("sends rows in display order as exact satang, and the saved rows that were removed", () => {
    let state = loaded([line("a"), section("s"), line("b")])
    state = gridReducer(state, { type: "remove", id: "b" })
    state = gridReducer(state, { type: "add", kind: "note", id: "n", defaults, at: 0 })
    state = gridReducer(state, { type: "edit", id: "n", patch: { description: "  Bring ID  " } })
    state = gridReducer(state, { type: "edit", id: "a", patch: { unitPrice: "1234.5", quantity: " 2.25 " } })
    expect(savePayload(state)).toEqual({
      rows: [
        { kind: "note", id: "n", description: "Bring ID" },
        { kind: "line", id: "a", product_id: null, description: "Line a", quantity: "2.25", unit: "piece", unit_price_satang: 123450, tax_rate_bps: 700 },
        { kind: "section", id: "s", description: "Section s" },
      ],
      deleted: ["b"],
    })
  })

  it("drops untouched new rows instead of blocking Save, but never a saved row", () => {
    let state = loaded([line("a")])
    state = gridReducer(state, { type: "add", kind: "line", id: "blank", defaults })
    state = gridReducer(state, { type: "add", kind: "section", id: "blank-section", defaults })
    state = gridReducer(state, { type: "edit", id: "a", patch: { description: "" } })
    expect(savePayload(state).rows.map(row => row.id)).toEqual(["a"])
    expect([...blockingIssues(state).keys()]).toEqual(["a"])
    state = gridReducer(state, { type: "edit", id: "blank", patch: { productId: "p1" } })
    expect([...blockingIssues(state).keys()]).toEqual(["a", "blank"])
  })
})

describe("server rows", () => {
  const sections = [
    { id: "tail", kind: "note", description: "Thanks", lines_before: 2, position: 2 },
    { id: "head", kind: "section", description: "Phase 1", lines_before: 0, position: 0 },
    { id: "mid", kind: "section", description: "Phase 2", lines_before: 1, position: 1 },
  ]

  it("places each section before the line it precedes and trailing ones last", () => {
    expect(interleave(["L0", "L1"], sections).map(row => typeof row === "string" ? row : row.id)).toEqual(["head", "L0", "mid", "L1", "tail"])
    expect(interleave([], sections).map(row => typeof row === "string" ? row : row.id)).toEqual(["head", "mid", "tail"])
    expect(interleave(["L0"], [{ id: "late", lines_before: 7, position: 0 }])).toEqual(["L0", { id: "late", lines_before: 7, position: 0 }])
  })

  it("loads exact decimal text for editing", () => {
    expect(toGridRows([{ id: "l", product_id: "p", description: "Steel", quantity: 1.5, unit: null, unit_price_satang: 33333, tax_rate_bps: 0, extras: ["1"] }], [sections[0]])).toEqual([
      { kind: "line", id: "l", productId: "p", description: "Steel", quantity: "1.5", unit: "", unitPrice: "333.33", taxRateBps: 0, extras: ["1"] },
      { kind: "note", id: "tail", description: "Thanks" },
    ])
  })
})

describe("spreadsheet keys", () => {
  const rows = [line("a"), section("s"), line("b")]
  const columns = (row: GridRow) => row.kind === "line" ? ["product", "description", "quantity", "unitPrice"] : ["description"]

  it("moves Enter down the same column, onto a section's text, and adds a line past the end", () => {
    expect(enterTarget(rows, 0, "quantity", false, columns)).toEqual({ index: 1, column: "description" })
    expect(enterTarget(rows, 1, "description", false, columns)).toEqual({ index: 2, column: "description" })
    expect(enterTarget(rows, 2, "unitPrice", false, columns)).toBe("add")
  })

  it("moves Shift+Enter up and stops at the first row", () => {
    expect(enterTarget(rows, 2, "quantity", true, columns)).toEqual({ index: 1, column: "description" })
    expect(enterTarget(rows, 0, "quantity", true, columns)).toBeNull()
  })
})
