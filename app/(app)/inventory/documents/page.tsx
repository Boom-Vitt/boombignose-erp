import Link from "next/link"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { PageHeader } from "@/components/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default async function StockDocumentsPage({ searchParams }: { searchParams: Promise<{ sourceId?: string }> }) {
  const ctx = await requireOrgContext()
  const source = z.guid().safeParse((await searchParams).sourceId).data
  const db = await createClient()
  const documents = await readAllOrThrow((from, to) => {
    let query = db.from("stock_documents").select("*").eq("org_id", ctx.orgId)
    if (source) query = query.or(`purchase_order_id.eq.${source},invoice_id.eq.${source}`)
    return query.order("created_at", { ascending: false }).order("id").range(from, to)
  })
  return <div className="space-y-6"><PageHeader title="Stock documents" description="Numbered receipt and delivery documents. Earlier ledger entries without a document remain legacy stock history." />
    <Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Kind</TableHead><TableHead>Source</TableHead><TableHead>Print</TableHead></TableRow></TableHeader><TableBody>{documents.map(doc => <TableRow key={doc.id}><TableCell>{doc.number}</TableCell><TableCell>{doc.document_date}</TableCell><TableCell>{doc.kind}</TableCell><TableCell><Link className="underline" href={doc.purchase_order_id ? `/purchases/${doc.purchase_order_id}` : `/finance/invoices/${doc.invoice_id}`}>Source document</Link></TableCell><TableCell><Link className="underline" target="_blank" href={`/inventory/documents/${doc.id}/print`}>Print {doc.number}</Link></TableCell></TableRow>)}</TableBody></Table>
    {!documents.length && <p>No stock documents yet.</p>}
  </div>
}
