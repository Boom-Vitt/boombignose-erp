import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Download, ListPlus } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB, satangToBaht } from "@/lib/money"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
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

import { updateQuote } from "../actions"
import {
  QuoteForm,
  type QuoteFormValues,
  type QuoteFormSubmitValues,
} from "../_components/quote-form"
import { QuoteItemForm } from "../_components/quote-item-form"
import { DeleteQuoteItemButton } from "../_components/delete-quote-item-button"
import { QuoteStatusControls } from "../_components/quote-status-controls"
import { QuoteStatusBadge } from "../_components/quote-status-badge"
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

  const [quoteRes, itemsRes, clientsRes, projectsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, number, status, issue_date, valid_until, subtotal_satang, discount_satang, total_satang, notes, client_id, project_id, converted_invoice_id, clients(name), projects(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("quote_items")
      .select("id, description, quantity, unit_price_satang, amount_satang, position")
      .eq("quote_id", id)
      .order("position", { ascending: true }),
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("projects").select("id, name").order("name"),
  ])

  const quote = quoteRes.data
  if (!quote) notFound()

  const items = itemsRes.data ?? []
  const canConvert = ctx.role === "owner" || ctx.role === "admin"
  const editable = quote.status === "draft" || quote.status === "sent"
  const locked = quote.status === "converted"

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
    discountBaht: satangToBaht(quote.discount_satang),
    notes: quote.notes ?? "",
  }

  // Bind the quote id into a real server action (see invoices/[id] for why a
  // plain closure can't cross the RSC boundary to a "use client" form).
  const quoteId = quote.id
  async function saveQuote(values: QuoteFormSubmitValues) {
    "use server"
    return updateQuote({ id: quoteId, ...values })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={quote.number}
        description={quote.clients?.name ?? "Quote"}
      >
        <Button
          variant="outline"
          render={<a href={`/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer" />}
        >
          <Download /> Download PDF
        </Button>
        <EmailQuoteButton quoteId={quote.id} />
        <Button variant="outline" render={<Link href="/quotes" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Overview</CardTitle>
          <QuoteStatusBadge status={quote.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Subtotal" value={formatTHB(quote.subtotal_satang)} />
            <Field label="Discount" value={formatTHB(quote.discount_satang)} />
            <Field
              label="Total"
              value={
                <span className="font-medium">{formatTHB(quote.total_satang)}</span>
              }
            />
            <Field label="Issue date" value={quote.issue_date ?? "—"} />
            <Field label="Valid until" value={quote.valid_until ?? "—"} />
            <Field label="Client" value={quote.clients?.name ?? "—"} />
            <Field label="Project" value={quote.projects?.name ?? "—"} />
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

          {quote.notes ? (
            <>
              <Separator />
              <Field label="Notes" value={quote.notes} />
            </>
          ) : null}

          <Separator />
          <QuoteStatusControls
            quoteId={quote.id}
            status={quote.status}
            canConvert={canConvert}
          />
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
                      {Number(it.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTHB(it.unit_price_satang)}
                    </TableCell>
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
            <p className="text-muted-foreground text-sm">Converted (locked)</p>
          ) : (
            <QuoteItemForm quoteId={quote.id} />
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
    </div>
  )
}
