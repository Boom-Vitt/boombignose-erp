import Link from "next/link"
import type { Tables } from "@/lib/types/database"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PurchaseAction } from "./action-button"
import { CreditForm } from "./credit-form"
import { markBillPaid } from "../actions"

export function VendorBills({ bills, canManage, lines = [] }: { bills: Tables<"costs">[]; canManage: boolean; lines?: Tables<"purchase_order_items">[] }) {
  const today = todayISO()
  return <section id="bills" aria-label="Vendor bills" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Vendor bills ({bills.length})</h2>
    {bills.length === 0 ? <p className="text-sm text-muted-foreground">No bills yet.</p> : <Table>
      <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Date</TableHead><TableHead>Due date</TableHead><TableHead>Amount</TableHead><TableHead>Input VAT</TableHead><TableHead>Payment</TableHead><TableHead>Purchase order</TableHead></TableRow></TableHeader>
      <TableBody>{bills.map(bill => <TableRow key={bill.id}>
        <TableCell>{bill.vendor_invoice_reference && <strong className="block">{bill.vendor_invoice_reference}</strong>}{bill.purchase_cost_kind === "return_adjustment" ? "Internal return adjustment" : bill.bill_number ?? (bill.purchase_cost_kind === "credit" ? "Vendor credit" : "Vendor bill")}</TableCell><TableCell>{bill.bill_date ?? bill.incurred_on}</TableCell>
        <TableCell className={!bill.paid_at && bill.due_date && bill.due_date < today ? "text-destructive" : ""}>{bill.due_date ?? "—"}</TableCell>
        <TableCell>{formatTHB(bill.amount_satang)}</TableCell><TableCell>{formatTHB(bill.input_vat_satang)} ({bill.input_vat_rate}%)</TableCell>
        <TableCell>{bill.purchase_cost_kind === "return_adjustment" || bill.vendor_id === null ? "Not payable" : bill.paid_at ? `Paid ${todayISO(new Date(bill.paid_at))}` : <div className="space-y-1"><span>{bill.due_date && bill.due_date < today ? "Overdue" : "Unpaid"}</span>{canManage && <PurchaseAction action={markBillPaid.bind(null, bill.id)} label="Mark paid" />}</div>}</TableCell>
        <TableCell>{bill.purchase_order_id ? <Link className="underline" href={`/purchases/${bill.purchase_order_id}`}>View purchase order</Link> : "—"}{canManage && lines.length > 0 && bill.purchase_cost_kind === "credit" && !bill.paid_at && !bill.vendor_bill_match_id && <CreditForm costId={bill.id} lines={lines} credits={bills.filter(item => item.purchase_order_id === bill.purchase_order_id && item.purchase_cost_kind === "credit" && !item.paid_at && !item.vendor_bill_match_id)} originals={bills.filter(item => item.purchase_order_id === bill.purchase_order_id && item.purchase_cost_kind === "bill" && item.vendor_bill_match_id !== null)} />}</TableCell>
      </TableRow>)}</TableBody>
    </Table>}
  </section>
}
