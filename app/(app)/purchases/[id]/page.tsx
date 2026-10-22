import Link from "next/link"
import { Receipt, Users, Package } from "lucide-react"
import { requireOrgContext } from "@/lib/auth"
import { inventoryData, stockMoveCount } from "@/lib/inventory/queries"
import { can } from "@/lib/permissions"
import { purchaseDetail, purchaseOptions } from "@/lib/purchasing/queries"
import { billAmount, hasUnbilledQuantities, purchaseTotal } from "@/lib/purchasing/quantities"
import { serviceLineAmount } from "@/lib/workflows/service"
import { formatTHB } from "@/lib/money"
import { PURCHASE_FLOW } from "@/lib/record/status"
import { PageHeader } from "@/components/page-header"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons } from "@/components/record/smart-buttons"
import { RecordHistory } from "@/components/record/record-history"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { transitionPurchase, createPurchaseBill, removePurchaseLine } from "../actions"
import { sendPurchaseRFQ } from "../email-actions"
import { PurchaseAction } from "../_components/action-button"
import { PurchaseLineForm } from "../_components/line-form"
import { ReceiptForm, PurchaseReturnForm } from "../_components/receipt-form"
import { VendorBills } from "../_components/bills"

export const dynamic = "force-dynamic"
export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const [{ order, lines, bills }, { warehouses }, receiptCount] = await Promise.all([purchaseDetail(id), inventoryData(), stockMoveCount({ sourceId: id })])
  const manage = can(ctx.role, "purchase:manage")
  const editable = manage && order.status === "draft"
  const products = editable ? (await purchaseOptions()).products : []
  const receivable = order.status === "confirmed"
  const unbilled = billAmount(lines)
  const billable = hasUnbilledQuantities(lines)
  const hasReceipts = lines.some(line => line.received_quantity > 0)
  const flow = { ...PURCHASE_FLOW, next: { ...PURCHASE_FLOW.next, confirmed: { ...PURCHASE_FLOW.next.confirmed, secondary: PURCHASE_FLOW.next.confirmed.secondary?.filter(action => !("to" in action) || (action.to === "closed" ? hasReceipts : action.to !== "cancelled" || !hasReceipts)) } } }
  return <div className="space-y-6">
    <PageHeader title={order.number} description={order.vendors?.name ?? "Purchase order"}>
      <Button variant="outline" render={<Link href={`/purchases/${id}/pdf`} target="_blank" />}>Print RFQ / PDF</Button>
    </PageHeader>
    <StatusBar label="Purchase status" flow={flow} status={order.status} transition={manage ? transitionPurchase.bind(null, id) : undefined} commands={manage ? {
      send_rfq: ({ label, variant }) => <PurchaseAction action={sendPurchaseRFQ.bind(null, id)} label={label} variant={variant} />,
      receive: "#receive",
      ...(billable ? { bill: ({ label, variant }: { label: string; variant: "default" | "outline" }) => <PurchaseAction action={createPurchaseBill.bind(null, id)} label={label} variant={variant} /> } : {}),
    } : {}} />
    {order.rfq_delivery_key && <p role="status" className="rounded-lg border p-3 text-sm">{order.rfq_delivered_at ? "RFQ delivery accepted." : order.rfq_delivery_error ? `RFQ delivery failed: ${order.rfq_delivery_error}. This order is frozen; print the RFQ or verify delivery with an administrator.` : "RFQ delivery claimed. Verify its outcome before recovery; it will not be sent again automatically."}</p>}
    <SmartButtons buttons={[
      { label: "Receipts", icon: Package, href: `/inventory/moves?sourceId=${id}`, count: receiptCount, nextStep: true },
      { label: "Bills", icon: Receipt, href: "#bills", count: bills.length, nextStep: true },
      { label: "Vendor", icon: Users, href: `/vendors/${order.vendor_id}`, count: 1, value: order.vendors?.name },
    ]} />
    <dl className="grid gap-4 rounded-xl border p-5 sm:grid-cols-3"><div><dt className="text-sm text-muted-foreground">Order date</dt><dd>{order.order_date}</dd></div><div><dt className="text-sm text-muted-foreground">Expected date</dt><dd>{order.expected_date ?? "—"}</dd></div><div><dt className="text-sm text-muted-foreground">Total</dt><dd className="font-semibold">{formatTHB(purchaseTotal(lines))}</dd></div>{order.notes && <div className="sm:col-span-3"><dt className="text-sm text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{order.notes}</dd></div>}</dl>
    <Table><TableHeader><TableRow><TableHead>Description</TableHead><TableHead>Quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>Received</TableHead><TableHead>Returned</TableHead><TableHead>Billed</TableHead><TableHead>Total</TableHead>{editable && <TableHead>Actions</TableHead>}</TableRow></TableHeader>
      <TableBody>{lines.map(line => <TableRow key={line.id}><TableCell>{line.description}</TableCell><TableCell>{line.quantity} {line.unit}</TableCell><TableCell>{formatTHB(line.unit_cost_satang)}</TableCell><TableCell>{line.received_quantity}</TableCell><TableCell>{line.returned_quantity}</TableCell><TableCell>{line.billed_quantity}</TableCell><TableCell>{formatTHB(serviceLineAmount(line.quantity, line.unit_cost_satang))}</TableCell>{editable && <TableCell><PurchaseAction action={removePurchaseLine.bind(null, id, line.id)} label={`Remove ${line.description}`} /></TableCell>}</TableRow>)}</TableBody>
    </Table>
    {!lines.length && <p className="text-sm text-muted-foreground">Add a line before sending or confirming this order.</p>}
    {editable && <PurchaseLineForm orderId={id} products={products} />}
    {manage && receivable && <ReceiptForm orderId={id} lines={lines} warehouses={warehouses.filter(w => w.active)} />}
    {manage && can(ctx.role, "inventory:manage") && hasReceipts && <PurchaseReturnForm orderId={id} lines={lines.filter(line => line.received_quantity > 0)} warehouses={warehouses.filter(w => w.active)} />}
    {order.status === "closed" && <p className="text-sm">The remaining quantities are closed. Received quantities can still be billed or returned.</p>}
    {unbilled > 0 && <p className="text-sm">Received and not yet billed: {formatTHB(unbilled)}</p>}
    <VendorBills bills={bills} canManage={manage} />
    <RecordHistory recordType="purchase_order" recordId={id} />
  </div>
}
