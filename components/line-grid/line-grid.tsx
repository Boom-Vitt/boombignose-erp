"use client"

import { useEffect, useId, useReducer, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { GripVertical, Heading, ListPlus, StickyNote, Trash2 } from "lucide-react"

import { formatTHB } from "@/lib/money"
import { productToLineValues, type ProductOption } from "@/lib/products/snapshot"
import { serviceAmountBaht, serviceAmountSatang } from "@/lib/workflows/service"
import {
  blockingIssues, EXTRA_HEADERS, enterTarget, gridReducer, gridTotals, isDirty, lineAmount, savePayload, untaxedTotal,
  type DocumentKind, type GridRow, type PricedLine, type RowKind, type TotalsBasis,
} from "@/lib/line-grid/grid"
import { saveDocumentLines } from "@/lib/line-grid/actions"
import { ProductPicker } from "@/app/(app)/products/_components/product-picker"
import { RecordFields, recordGuard, useGuardedEditor, useHeldTransition } from "@/components/record/record-guard"
import { DocumentTotals } from "@/components/document-totals"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

type Props = {
  document: DocumentKind
  documentId: string
  rows: GridRow[]
  editable: boolean
  lockedMessage?: string
  products?: ProductOption[]
  canManageProducts?: boolean
  /** VAT rates offered per line; omitted for untaxed documents (purchase orders). */
  taxRates?: number[]
  defaultTaxRateBps?: number
  /** Header values the totals depend on; omitted for untaxed documents. */
  basis?: TotalsBasis
}

const LABEL: Record<RowKind, string> = { line: "Line", section: "Section", note: "Note" }

/** One editable line grid for quotes, invoices and purchase orders, saved in one atomic call. */
export function LineGrid({ document, documentId, rows: serverRows, editable, lockedMessage, products = [], canManageProducts = false, taxRates, defaultTaxRateBps = 0, basis }: Props) {
  const id = useId()
  const router = useRouter()
  const [state, dispatch] = useReducer(gridReducer, { saved: serverRows, rows: serverRows })
  const [seenServer, setSeenServer] = useState(serverRows)
  const [saving, setSaving] = useState(false)
  const [showIssues, setShowIssues] = useState(false)
  const [error, setError] = useState("")
  const [announcement, setAnnouncement] = useState("")
  const [, startRefresh] = useHeldTransition()
  const cells = useRef(new Map<string, HTMLElement>())
  const dragFrom = useRef<number | null>(null)
  const pendingFocus = useRef<string | null>(null)

  // The refreshed page brings the server's rows; adopt them unless the user is mid-edit.
  if (seenServer !== serverRows) {
    setSeenServer(serverRows)
    if (!isDirty(state)) dispatch({ type: "reset", rows: serverRows })
  }

  const dirty = isDirty(state)
  const issues = blockingIssues(state, document === "purchase_order")
  const taxed = taxRates !== undefined
  const priceLabel = document === "purchase_order" ? "Unit cost" : "Unit price"
  const extraHeaders = EXTRA_HEADERS[document]
  const inputColumns = ["description", "quantity", "unit", "unitPrice", ...(taxed ? ["taxRate"] : [])]
  const columnsOf = (row: GridRow) => row.kind === "line" ? inputColumns : ["description"]
  const middleColumns = 6 + (taxed ? 1 : 0) + extraHeaders.length

  // A cell that a new or moved row renders gets focus once it is in the DOM.
  useEffect(() => {
    if (!pendingFocus.current) return
    cells.current.get(pendingFocus.current)?.focus()
    pendingFocus.current = null
  })

  function focusCell(rowId: string, column: string) {
    const cell = cells.current.get(`${rowId}:${column}`)
    if (cell) cell.focus()
    else pendingFocus.current = `${rowId}:${column}`
  }

  async function save(): Promise<boolean> {
    if (issues.size) {
      setShowIssues(true)
      setError(`Fix the highlighted cells in ${issues.size} row${issues.size === 1 ? "" : "s"}, then save again.`)
      return false
    }
    setSaving(true)
    setError("")
    try {
      const result = await saveDocumentLines({ document, documentId, ...savePayload(state) })
      if (result.error || !result.rows) {
        setError(result.error ?? "Lines were not saved.")
        return false
      }
      dispatch({ type: "reset", rows: result.rows })
      setShowIssues(false)
      startRefresh(() => router.refresh())
      return true
    } catch {
      setError("Could not confirm the save. Save again; a repeated save does not duplicate lines.")
      return false
    } finally {
      setSaving(false)
    }
  }

  useGuardedEditor(id, editable && dirty, save)

  function add(kind: RowKind, at?: number) {
    const rowId = crypto.randomUUID()
    pendingFocus.current = `${rowId}:description`
    dispatch({ type: "add", kind, id: rowId, at, defaults: { taxRateBps: defaultTaxRateBps, unit: "piece" } })
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= state.rows.length) return
    dispatch({ type: "move", from, to })
    setAnnouncement(`Moved ${LABEL[state.rows[from].kind].toLowerCase()} to row ${to + 1} of ${state.rows.length}`)
  }

  function onCellKey(event: KeyboardEvent<HTMLElement>, index: number, column: string) {
    const row = state.rows[index]
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      const target = enterTarget(state.rows, index, column, event.shiftKey, columnsOf)
      if (target === "add") add("line")
      else if (target) focusCell(state.rows[target.index].id, target.column)
      return
    }
    // Tab past the last cell of a filled-in last row starts a new line, as in Odoo.
    const last = columnsOf(row).at(-1)
    if (event.key === "Tab" && !event.shiftKey && index === state.rows.length - 1 && column === last && row.description.trim()) {
      event.preventDefault()
      add("line")
    }
  }

  function cellRef(rowId: string, column: string) {
    return (element: HTMLElement | null) => {
      if (element) cells.current.set(`${rowId}:${column}`, element)
      else cells.current.delete(`${rowId}:${column}`)
    }
  }

  function pickProduct(line: PricedLine, product: ProductOption | null) {
    if (!product) return dispatch({ type: "edit", id: line.id, patch: { productId: null } })
    const values = productToLineValues(product)
    dispatch({
      type: "edit", id: line.id, patch: {
        productId: values.product_id, description: values.description, unit: values.unit,
        unitPrice: document === "purchase_order" ? serviceAmountBaht(product.cost_satang ?? 0) : values.unitPriceBaht,
        taxRateBps: taxed ? product.tax_rate_bps ?? defaultTaxRateBps : 0,
      },
    })
  }

  function onDrop(event: DragEvent, to: number) {
    event.preventDefault()
    if (dragFrom.current !== null) move(dragFrom.current, to)
    dragFrom.current = null
  }

  const totals = basis ? gridTotals(state.rows, basis) : null
  const rowLabel = (row: GridRow, index: number) => `${row.kind === "line" ? "line" : LABEL[row.kind].toLowerCase()} ${index + 1}`

  const table = (
    <Table aria-label="Line items">
      <TableHeader>
        <TableRow>
          {editable ? <TableHead className="w-8"><span className="sr-only">Reorder</span></TableHead> : null}
          <TableHead className="min-w-40">Product</TableHead>
          <TableHead className="min-w-56">Description</TableHead>
          <TableHead className="w-24 text-right">Qty</TableHead>
          <TableHead className="w-24">Unit</TableHead>
          <TableHead className="w-32 text-right">{priceLabel}</TableHead>
          {taxed ? <TableHead className="w-24">VAT</TableHead> : null}
          {extraHeaders.map(header => <TableHead key={header} className="text-right">{header}</TableHead>)}
          <TableHead className="text-right">Amount</TableHead>
          {editable ? <TableHead className="w-10"><span className="sr-only">Delete</span></TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.rows.length === 0 ? (
          <TableRow><TableCell colSpan={middleColumns + (editable ? 2 : 0)} className="text-muted-foreground">No line items yet.</TableCell></TableRow>
        ) : null}
        {state.rows.map((row, index) => {
          const rowIssues = showIssues ? issues.get(row.id) ?? {} : {}
          const label = rowLabel(row, index)
          const invalid = (field: keyof typeof rowIssues) => rowIssues[field] ? { "aria-invalid": true, title: rowIssues[field] } : {}
          const handle = editable ? (
            <TableCell className="px-1 align-middle">
              <button
                type="button"
                draggable
                aria-label={`Move ${label}`}
                aria-describedby={`${id}-reorder-hint`}
                className="text-muted-foreground hover:text-foreground cursor-grab rounded p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onDragStart={event => {
                  dragFrom.current = index
                  event.dataTransfer.effectAllowed = "move"
                  // A private type, so dropping on a cell never pastes the index as text.
                  event.dataTransfer.setData("application/x-line-grid-row", String(index))
                  const rowElement = event.currentTarget.closest("tr")
                  if (rowElement) event.dataTransfer.setDragImage(rowElement, 0, 0)
                }}
                onKeyDown={event => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
                  event.preventDefault()
                  // Moving the row's DOM node drops focus, so the handle takes it back after the move renders.
                  pendingFocus.current = `${row.id}:handle`
                  move(index, index + (event.key === "ArrowUp" ? -1 : 1))
                }}
                ref={cellRef(row.id, "handle")}
              >
                <GripVertical className="size-4" />
              </button>
            </TableCell>
          ) : null
          const remove = editable ? (
            <TableCell className="px-1">
              <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${label}`} onClick={() => dispatch({ type: "remove", id: row.id })}>
                <Trash2 className="text-muted-foreground" />
              </Button>
            </TableCell>
          ) : null
          const dropProps = editable ? { onDragOver: (event: DragEvent) => event.preventDefault(), onDrop: (event: DragEvent) => onDrop(event, index) } : {}

          if (row.kind !== "line") {
            return (
              <TableRow key={row.id} data-row-kind={row.kind} className={row.kind === "section" ? "bg-muted/60" : undefined} {...dropProps}>
                {handle}
                <TableCell colSpan={middleColumns}>
                  {editable ? (
                    <Input
                      aria-label={`${LABEL[row.kind]} text, row ${index + 1}`}
                      placeholder={row.kind === "section" ? "Section title" : "Note"}
                      className={cn(row.kind === "section" ? "font-semibold" : "italic")}
                      maxLength={4000}
                      value={row.description}
                      onChange={event => dispatch({ type: "edit", id: row.id, patch: { description: event.target.value } })}
                      onKeyDown={event => onCellKey(event, index, "description")}
                      ref={cellRef(row.id, "description")}
                      {...invalid("description")}
                    />
                  ) : (
                    <span className={cn("whitespace-pre-wrap", row.kind === "section" ? "font-semibold" : "text-muted-foreground italic")}>{row.description}</span>
                  )}
                </TableCell>
                {remove}
              </TableRow>
            )
          }

          const amount = lineAmount(row)
          const rates = taxRates ? [...new Set([...taxRates, row.taxRateBps])].sort((a, b) => a - b) : []
          return (
            <TableRow key={row.id} data-row-kind="line" {...dropProps}>
              {handle}
              <TableCell>
                {editable ? (
                  <ProductPicker products={products} value={row.productId} canManage={canManageProducts} hideLabel label={`Product, row ${index + 1}`} withCost={document === "purchase_order"} onChange={product => pickProduct(row, product)} />
                ) : (
                  <span className="text-muted-foreground">{row.productId ? products.find(product => product.id === row.productId)?.name ?? "Catalog product" : "—"}</span>
                )}
              </TableCell>
              <TableCell>
                {editable ? (
                  <Input aria-label={`Description, row ${index + 1}`} maxLength={4000} value={row.description}
                    onChange={event => dispatch({ type: "edit", id: row.id, patch: { description: event.target.value } })}
                    onKeyDown={event => onCellKey(event, index, "description")} ref={cellRef(row.id, "description")} {...invalid("description")} />
                ) : <span className="font-medium">{row.description}</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {editable ? (
                  <Input aria-label={`Quantity, row ${index + 1}`} inputMode="decimal" className="text-right" value={row.quantity}
                    onChange={event => dispatch({ type: "edit", id: row.id, patch: { quantity: event.target.value } })}
                    onKeyDown={event => onCellKey(event, index, "quantity")} ref={cellRef(row.id, "quantity")} {...invalid("quantity")} />
                ) : row.quantity}
              </TableCell>
              <TableCell>
                {editable ? (
                  <Input aria-label={`Unit, row ${index + 1}`} maxLength={40} value={row.unit} readOnly={row.productId !== null}
                    title={row.productId !== null ? "The unit follows the product" : undefined}
                    onChange={event => dispatch({ type: "edit", id: row.id, patch: { unit: event.target.value } })}
                    onKeyDown={event => onCellKey(event, index, "unit")} ref={cellRef(row.id, "unit")} {...invalid("unit")} />
                ) : row.unit}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {editable ? (
                  <Input aria-label={`${priceLabel}, row ${index + 1}`} inputMode="decimal" className="text-right" value={row.unitPrice}
                    onChange={event => dispatch({ type: "edit", id: row.id, patch: { unitPrice: event.target.value } })}
                    onKeyDown={event => onCellKey(event, index, "unitPrice")} ref={cellRef(row.id, "unitPrice")} {...invalid("unitPrice")} />
                ) : formatTHB(serviceAmountSatang(row.unitPrice))}
              </TableCell>
              {taxed ? (
                <TableCell>
                  {editable ? (
                    <select aria-label={`VAT, row ${index + 1}`} value={row.taxRateBps}
                      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                      onChange={event => dispatch({ type: "edit", id: row.id, patch: { taxRateBps: Number(event.target.value) } })}
                      onKeyDown={event => onCellKey(event, index, "taxRate")} ref={cellRef(row.id, "taxRate")}>
                      {rates.map(rate => <option key={rate} value={rate}>{rate / 100}%</option>)}
                    </select>
                  ) : `${row.taxRateBps / 100}%`}
                </TableCell>
              ) : null}
              {extraHeaders.map((header, column) => <TableCell key={header} className="text-right tabular-nums">{row.extras?.[column] ?? "0"}</TableCell>)}
              <TableCell className="text-right tabular-nums" data-testid="line-amount">{amount === null ? "—" : formatTHB(amount)}</TableCell>
              {remove}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  const totalsBlock = totals && basis ? (
    <DocumentTotals testId="line-grid-totals" subtotal={totals.subtotalSatang} discount={totals.discountSatang} vat={totals.vatSatang} total={totals.totalSatang}
      wht={totals.whtSatang} whtRate={basis.whtRateBps} amountDue={totals.amountDueSatang} breakdown={totals.vatByRate} inclusive={basis.pricesIncludeVat} />
  ) : (
    <dl className="ml-auto flex max-w-sm justify-between gap-6 border-t pt-2 text-sm font-semibold" data-testid="line-grid-totals">
      <dt>Total</dt><dd className="tabular-nums">{formatTHB(untaxedTotal(state.rows))}</dd>
    </dl>
  )

  if (!editable) {
    return (
      <div className="space-y-4">
        {table}
        {totalsBlock}
        {lockedMessage ? <p className="text-muted-foreground text-sm">{lockedMessage}</p> : null}
      </div>
    )
  }

  return (
    <RecordFields>
      <form
        className="space-y-4"
        aria-label="Edit line items"
        onSubmit={async event => {
          event.preventDefault()
          recordGuard.hold(`${id}:save`, true)
          try { await save() } finally { recordGuard.hold(`${id}:save`, false) }
        }}
      >
        <fieldset disabled={saving} aria-busy={saving} className="min-w-0 space-y-4">
          <p id={`${id}-reorder-hint`} className="sr-only">Drag the handle, or focus it and press the up or down arrow, to reorder rows.</p>
          <p className="sr-only" aria-live="polite">{announcement}</p>
          {table}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => add("line")}><ListPlus /> Add a line</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => add("section")}><Heading /> Add a section</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => add("note")}><StickyNote /> Add a note</Button>
            <span className="ml-auto flex items-center gap-2">
              {dirty ? <span role="status" className="text-sm text-amber-700 dark:text-amber-400">Unsaved line changes</span> : null}
              <Button type="button" variant="ghost" size="sm" disabled={!dirty} onClick={() => { dispatch({ type: "discard" }); setShowIssues(false); setError("") }}>Discard</Button>
              <Button type="submit" size="sm" disabled={!dirty}>{saving ? "Saving…" : "Save lines"}</Button>
            </span>
          </div>
          {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
          {totalsBlock}
        </fieldset>
      </form>
    </RecordFields>
  )
}
