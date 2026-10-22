import { readAll } from "@/lib/queries/read-all"
import { DocumentTotals } from "@/components/document-totals"
import { RecordHistory } from "@/components/record/record-history"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Download, FolderKanban, ListPlus, ReceiptText } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB } from "@/lib/money"
import { quoteIsEditable, serviceAmountBaht } from "@/lib/workflows/service"
import { todayISO } from "@/lib/dates"
import { activeProductOptions } from "@/lib/products/queries"
import { can } from "@/lib/permissions"
import { QUOTE_FLOW } from "@/lib/record/status"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { QuoteStatusBadge } from "@/components/status-badge"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons, recordHref } from "@/components/record/smart-buttons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import { setQuoteStatus, updateQuote } from "../actions"
import {
  QuoteForm,
  type QuoteFormValues,
  type QuoteFormSubmitValues,
} from "../_components/quote-form"
import { QuoteItemForm } from "../_components/quote-item-form"
import { DeleteQuoteItemButton } from "../_components/delete-quote-item-button"
import { ConvertQuoteButton } from "../_components/convert-quote-button"
import { EmailQuoteButton } from "../_components/email-quote-button"
import type { Option } from "../_components/form-fields"

export const dynamic = "force-dynamic"

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const [quoteRes, itemsRes, clientsRes, projectsRes, invoicesRes, settingsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, number, status, issue_date, valid_until, subtotal_satang, discount_satang, total_satang, vat_satang, tax_breakdown, prices_include_vat, notes, client_id, project_id, converted_invoice_id, clients(name)"
      ).eq("org_id", ctx.orgId)
      .eq("id", id)
      .maybeSingle(),
    readAll((from, to) => supabase
      .from("quote_items")
      .select("id, description, quantity, unit_price_satang, amount_satang, position, unit, tax_rate_bps")
      .eq("org_id", ctx.orgId)
      .eq("quote_id", id)
      .order("position", { ascending: true }).order("id").range(from, to)),
    supabase.from("clients").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase.from("projects").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase.from("invoices").select("id").eq("org_id", ctx.orgId).eq("source_quote_id", id),
    supabase.from("org_settings").select("vat_registered, vat_rate_bps").eq("org_id", ctx.orgId).maybeSingle(),
  ])

  const quote = quoteRes.data
  if (!quote) notFound()

  const { data: deliveryMilestones, error: milestoneError } = await supabase
    .from("milestones")
    .select("id, title, done, project_id")
    .eq("org_id", ctx.orgId)
    .eq("source_quote_id", quote.id)
    .order("created_at", { ascending: true })
  if (milestoneError) throw new Error(milestoneError.message)

  if (itemsRes.error || settingsRes.error) throw new Error("Quote details unavailable")
  const items = itemsRes.data ?? []
  const canConvert = (ctx.role === "owner" || ctx.role === "admin") && (!quote.valid_until || quote.valid_until >= todayISO())
  const editable = quoteIsEditable(quote.status)
  const locked = !editable
  const linkedProject = (projectsRes.data ?? []).find((p) => p.id === quote.project_id)

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: QuoteFormValues = {
    client_id: quote.client_id,
    project_id: quote.project_id ?? "",
    number: quote.number,
    issue_date: quote.issue_date ?? "",
    valid_until: quote.valid_until ?? "",
    discountBaht: serviceAmountBaht(quote.discount_satang),
    notes: quote.notes ?? "",
  }

  // Bind the quote id into a real server action (see invoices/[id] for why a
  // plain closure can't cross the RSC boundary to a "use client" form).
  const quoteId = quote.id
  async function saveQuote(values: QuoteFormSubmitValues) {
    "use server"
    return updateQuote({ id: quoteId, ...values })
  }
  async function transitionQuote(to: Enums<"quote_status">) {
    "use server"
    if (to === "converted") return { error: "Use quote conversion to create the linked records." }
    return setQuoteStatus({ id: quoteId, status: to })
  }
  const invoiceIds = (invoicesRes.data ?? []).map((invoice) => invoice.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title={quote.number}
        description={quote.clients?.name ?? "Quote"}
        breadcrumbs={[{ label: "Quotes", href: "/quotes" }]}
      >
        <Button
          variant="outline"
          render={<a href={`/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer" />}
        >
          <Download /> Download PDF
        </Button>
        <EmailQuoteButton quoteId={quote.id} />
      </PageHeader>

      <SmartButtons
        buttons={[
          {
            label: "Invoices",
            icon: ReceiptText,
            count: invoiceIds.length,
            href: recordHref(
              invoiceIds,
              (invoiceId) => `/finance/invoices/${invoiceId}`,
              quote.project_id ? `/projects/${quote.project_id}#billing` : "/finance"
            ),
          },
          {
            label: "Project",
            icon: FolderKanban,
            count: quote.project_id ? 1 : 0,
            href: `/projects/${quote.project_id}`,
          },
        ]}
      />
      <StatusBar
        label="Quote status"
        flow={QUOTE_FLOW}
        status={quote.status}
        transition={transitionQuote}
        commands={
          canConvert
            ? { convert: (props) => <ConvertQuoteButton quoteId={quote.id} orgId={ctx.orgId} {...props} /> }
            : {}
        }
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Overview</CardTitle>
          <QuoteStatusBadge status={quote.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <DocumentTotals subtotal={quote.subtotal_satang} discount={quote.discount_satang} vat={quote.vat_satang} total={quote.total_satang} breakdown={quote.tax_breakdown} inclusive={quote.prices_include_vat} />
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Issue date" value={quote.issue_date ?? "—"} />
            <Field label="Valid until" value={quote.valid_until ?? "—"} />
            <Field label="Client" value={quote.clients?.name ?? "—"} />
            <Field label="Project" value={linkedProject ? (
              <Link href={`/projects/${linkedProject.id}`} className="hover:underline">{linkedProject.name}</Link>
            ) : "—"} />
            {quote.converted_invoice_id ? (
              <Field
                label="Converted invoice"
                value={
                  <Link
                    href={`/finance/invoices/${quote.converted_invoice_id}`}
                    className="hover:underline"
                  >
                    View invoice
                  </Link>
                }
              />
            ) : null}
          </dl>

          {deliveryMilestones?.length ? (
            <Field label="Delivery milestones" value={
              <ul className="space-y-1">
                {deliveryMilestones.map((milestone) => (
                  <li key={milestone.id}>
                    <Link href={`/projects/${milestone.project_id}#milestone-${milestone.id}`} className="hover:underline">
                      {milestone.title} · {milestone.done ? "Done" : "Pending"}
                    </Link>
                  </li>
                ))}
              </ul>
            } />
          ) : null}

          {quote.notes ? (
            <>
              <Separator />
              <Field label="Notes" value={quote.notes} />
            </>
          ) : null}

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {items.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title="No line items yet"
              description="Add items below to build up this quote's total."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {locked ? null : (
                    <TableHead className="w-10" aria-label="Actions" />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(it.quantity)} {it.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTHB(it.unit_price_satang)}
                    </TableCell>
                    <TableCell className="text-right">{it.tax_rate_bps / 100}%</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTHB(it.amount_satang)}
                    </TableCell>
                    {locked ? null : (
                      <TableCell className="text-right">
                        <DeleteQuoteItemButton id={it.id} label={it.description} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Separator />
          {locked ? (
            <p className="text-muted-foreground text-sm">{quote.status === "accepted" ? "Accepted scope is locked." : "This quote is locked."}</p>
          ) : (
            <QuoteItemForm defaultTaxRate={settingsRes.data?.vat_registered ? settingsRes.data.vat_rate_bps : 0} quoteId={quote.id} products={await activeProductOptions()} canManageProducts={can(ctx.role, "product:manage")} />
          )}
        </CardContent>
      </Card>

      {editable ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-base">Edit quote</CardTitle>
          </CardHeader>
          <CardContent>
            <QuoteForm
              clients={clients}
              projects={projects}
              defaultValues={defaultValues}
              submitLabel="Save changes"
              action={saveQuote}
            />
          </CardContent>
        </Card>
      ) : null}
      <RecordHistory recordType="quote" recordId={id} />
    </div>
  )
}
