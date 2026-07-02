import Link from "next/link"
import { FileText, FilePlus2 } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB } from "@/lib/money"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import { QuoteStatusBadge } from "./_components/quote-status-badge"

export const dynamic = "force-dynamic"

export default async function QuotesPage() {
  await requireOrgContext()
  const supabase = await createClient()

  const { data } = await supabase
    .from("quotes")
    .select(
      "id, number, status, total_satang, valid_until, issue_date, clients(name)"
    )
    .order("issue_date", { ascending: false })

  const quotes = data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        description="Draft proposals, track acceptance, and convert to invoices."
      >
        <Button render={<Link href="/quotes/new" />}>
          <FilePlus2 /> New quote
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quotes</CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No quotes yet"
              description="Create your first quote to send a proposal to a client."
              action={
                <Button render={<Link href="/quotes/new" />}>
                  <FilePlus2 /> New quote
                </Button>
              }
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Valid until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/quotes/${q.id}`}
                        className="hover:underline"
                      >
                        {q.number}
                      </Link>
                    </TableCell>
                    <TableCell>{q.clients?.name ?? "—"}</TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTHB(q.total_satang)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {q.valid_until ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
