import Link from "next/link"
import type { Tables } from "@/lib/types/database"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PurchaseAction } from "./action-button"
import { markBillPaid } from "../actions"

export function VendorBills({ bills, canManage }: { bills: Tables<"costs">[]; canManage: boolean }) {
  const today = todayISO()
  return <section id="bills" aria-label="Vendor bills" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Vendor bills ({bills.length})</h2>
    {bills.length === 0 ? <p className="text-sm text-muted-foreground">No bills yet.</p> : <Table>
      <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Date</TableHead><TableHead>Due date</TableHead><TableHead>Amount</TableHead><TableHead>Payment</TableHead><TableHead>Purchase order</TableHead></TableRow></TableHeader>
      <TableBody>{bills.map(bill => <TableRow key={bill.id}>
        <TableCell>{bill.bill_number ?? "Vendor bill"}</TableCell><TableCell>{bill.bill_date ?? bill.incurred_on}</TableCell>
        <TableCell className={!bill.paid_at && bill.due_date && bill.due_date < today ? "text-destructive" : ""}>{bill.due_date ?? "—"}</TableCell>
        <TableCell>{formatTHB(bill.amount_satang)}</TableCell>
        <TableCell>{bill.paid_at ? `Paid ${bill.paid_at.slice(0, 10)}` : <div className="space-y-1"><span>{bill.due_date && bill.due_date < today ? "Overdue" : "Unpaid"}</span>{canManage && <PurchaseAction action={markBillPaid.bind(null, bill.id)} label="Mark paid" />}</div>}</TableCell>
        <TableCell>{bill.purchase_order_id ? <Link className="underline" href={`/purchases/${bill.purchase_order_id}`}>View purchase order</Link> : "—"}</TableCell>
      </TableRow>)}</TableBody>
    </Table>}
  </section>
}
