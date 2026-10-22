import { readAll } from "@/lib/queries/read-all"
import { DocumentTotals } from "@/components/document-totals"
import { FileText, Receipt, FolderKanban, Lock } from "lucide-react"

import { createAdminClient } from "@/lib/supabase/admin"
import { formatTHB } from "@/lib/money"
import type { Enums } from "@/lib/types/database"
import { todayISO } from "@/lib/dates"
import {
  deriveInvoiceStatus,
  outstandingSatang,
} from "@/lib/metrics/invoice-status"
import { InvoiceStatusBadge, ProjectStatusBadge } from "@/components/status-badge"
import { QuoteStatusBadge } from "@/app/(app)/quotes/_components/quote-status-badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import { AcceptQuoteButton } from "@/ee/portal/components/accept-quote-button"
import { MarkInvoicePaidButton } from "@/ee/portal/components/mark-invoice-paid-button"

// PUBLIC route (no session). Served with the service-role admin client, scoped
// strictly to the one client resolved from the opaque token. Never cache.

// Allowlist of customer-facing statuses. Drafts and cancelled invoices are
// internal and never leave the workspace; a quote only reaches `converted`
// from `accepted`, so the client has already seen it.
const PORTAL_QUOTE_STATUSES: Enums<"quote_status">[] = ["sent", "accepted", "declined", "expired", "converted"]
const PORTAL_INVOICE_STATUSES: Enums<"invoice_status">[] = ["sent", "partially_paid", "paid", "overdue"]

function Unavailable() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="bg-muted flex size-12 items-center justify-center rounded-full">
        <Lock className="text-muted-foreground size-5" />
      </div>
      <h1 className="text-xl font-semibold">Portal unavailable</h1>
      <p className="text-muted-foreground text-sm">
        This link is no longer active. Please contact your account manager for an
        up-to-date link.
      </p>
    </main>
  )
}

export default async function ClientPortalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token) return <Unavailable />

  const supabase = createAdminClient()

  // Resolve the token → client. Only enabled portals resolve; a missing or
  // disabled token renders the same generic page (no existence leak).
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, org_id")
    .eq("portal_token", token)
    .eq("portal_enabled", true)
    .maybeSingle()

  if (clientErr || !client) return <Unavailable />

  const today = todayISO()

  const [orgRes, quotesRes, invoicesRes, projectsRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", client.org_id)
      .maybeSingle(),
    readAll((from, to) => supabase
      .from("quotes")
      .select("id, number, status, subtotal_satang, discount_satang, vat_satang, tax_breakdown, prices_include_vat, total_satang")
      .eq("client_id", client.id)
      .eq("org_id", client.org_id)
      .in("status", PORTAL_QUOTE_STATUSES)
      .order("created_at", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("invoices")
      .select("id, number, status, amount_satang, subtotal_satang, discount_satang, vat_satang, wht_satang, wht_rate_bps, total_satang, tax_breakdown, prices_include_vat, issue_date, due_date")
      .eq("client_id", client.id)
      .eq("org_id", client.org_id)
      .in("status", PORTAL_INVOICE_STATUSES)
      .order("created_at", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("projects")
      .select("id, name, status")
      .eq("client_id", client.id)
      .eq("org_id", client.org_id)
      .order("created_at", { ascending: false }).order("id").range(from, to)),
  ])

  if (quotesRes.error || invoicesRes.error || projectsRes.error) return <Unavailable />
  const quotes = quotesRes.data ?? []
  const invoices = invoicesRes.data ?? []
  const projects = projectsRes.data ?? []

  // Payments + line items for THIS client's invoices only, so we can show
  // outstanding, an effective status, and an inline item summary (the PDF
  // routes require a session, so they are intentionally not linked here).
  const invoiceIds = invoices.map((i) => i.id)
  const [paymentsRes, itemsRes, claimsRes] = await Promise.all([
    invoiceIds.length
      ? readAll((from, to) => supabase
          .from("payments")
          .select("invoice_id, amount_satang, invoices!inner(client_id)").eq("verification_state", "verified")
          .eq("invoices.client_id", client.id)
          .eq("org_id", client.org_id).order("id").range(from, to))
      : Promise.resolve({ data: [] as { invoice_id: string; amount_satang: number }[], error: null }),
    invoiceIds.length
      ? readAll((from, to) => supabase
          .from("invoice_items")
          .select("invoice_id, description, quantity, amount_satang, invoices!inner(client_id)")
          .eq("invoices.client_id", client.id)
          .eq("org_id", client.org_id)
          .order("position", { ascending: true }).order("id").range(from, to))
      : Promise.resolve({
          data: [] as {
            invoice_id: string
            description: string
            quantity: number
            amount_satang: number
          }[], error: null,
        }),
    readAll((from, to) => supabase.from("payment_claims").select("invoice_id, status").eq("org_id",client.org_id).eq("client_id",client.id).eq("status","pending").order("id").range(from, to)),
  ])

  if (paymentsRes.error || itemsRes.error || claimsRes.error) return <Unavailable />
  const pendingInvoiceIds = new Set((claimsRes.data ?? []).map(c=>c.invoice_id))

  const paidByInvoice = new Map<string, number>()
  for (const p of paymentsRes.data ?? []) {
    paidByInvoice.set(
      p.invoice_id,
      (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount_satang
    )
  }

  const itemsByInvoice = new Map<
    string,
    { description: string; quantity: number; amount_satang: number }[]
  >()
  for (const it of itemsRes.data ?? []) {
    const list = itemsByInvoice.get(it.invoice_id) ?? []
    list.push({
      description: it.description,
      quantity: Number(it.quantity),
      amount_satang: it.amount_satang,
    })
    itemsByInvoice.set(it.invoice_id, list)
  }

  const orgName = orgRes.data?.name ?? "Workspace"

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <header className="space-y-1">
        <p className="text-muted-foreground text-sm font-medium">{orgName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
        <p className="text-muted-foreground text-sm">
          Your quotes, invoices, and projects. VAT and withholding are document calculations only, not a legal tax system, accounting ledger, tax filing or e-Tax Invoice.
        </p>
      </header>

      {/* Quotes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> Quotes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No quotes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-32 text-right" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">{q.number}</TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <DocumentTotals subtotal={q.subtotal_satang ?? q.total_satang} discount={q.discount_satang ?? 0} vat={q.vat_satang ?? 0} total={q.total_satang} breakdown={q.tax_breakdown ?? []} inclusive={q.prices_include_vat} />
                    </TableCell>
                    <TableCell className="text-right">
                      {q.status === "sent" ? (
                        <AcceptQuoteButton token={token} quoteId={q.id} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="size-4" /> Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices yet.</p>
          ) : (
            invoices.map((inv) => {
              const paid = paidByInvoice.get(inv.id) ?? 0
              const outstanding = outstandingSatang(inv.amount_satang, paid)
              const effectiveStatus = deriveInvoiceStatus(inv, paid, today)
              const items = itemsByInvoice.get(inv.id) ?? []
              const canPay =
                effectiveStatus !== "paid" && effectiveStatus !== "cancelled"

              return (
                <div key={inv.id} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{inv.number}</span>
                      <InvoiceStatusBadge status={effectiveStatus} />
                    </div>
                    {canPay ? (
                      pendingInvoiceIds.has(inv.id) ? <span>รอตรวจสอบ / Pending verification</span> : <MarkInvoicePaidButton token={token} invoiceId={inv.id} />
                    ) : null}
                  </div>

                  <DocumentTotals subtotal={inv.subtotal_satang ?? inv.amount_satang} discount={inv.discount_satang ?? 0} vat={inv.vat_satang ?? 0} total={inv.total_satang ?? inv.amount_satang} wht={inv.wht_satang ?? 0} whtRate={inv.wht_rate_bps ?? 0} amountDue={inv.amount_satang} breakdown={inv.tax_breakdown ?? []} inclusive={inv.prices_include_vat} />
                  <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    <div className="space-y-0.5">
                      <dt className="text-muted-foreground text-xs font-medium">
                        Amount
                      </dt>
                      <dd className="tabular-nums">
                        {formatTHB(inv.amount_satang)}
                      </dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-muted-foreground text-xs font-medium">
                        Outstanding
                      </dt>
                      <dd
                        className={
                          outstanding > 0
                            ? "font-medium tabular-nums"
                            : "tabular-nums"
                        }
                      >
                        {formatTHB(outstanding)}
                      </dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-muted-foreground text-xs font-medium">
                        Issue date
                      </dt>
                      <dd>{inv.issue_date ?? "—"}</dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-muted-foreground text-xs font-medium">
                        Due date
                      </dt>
                      <dd>{inv.due_date ?? "—"}</dd>
                    </div>
                  </dl>

                  {items.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((it, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{it.description}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {it.quantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatTHB(it.amount_satang)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}

                  <Separator />
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Projects */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderKanban className="size-4" /> Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects yet.</p>
          ) : (
            <ul className="divide-y">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                  <ProjectStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
