import Link from "next/link"
import { expenseClaimLists } from "@/lib/expenses/queries"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import type { Tables } from "@/lib/types/database"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export const dynamic = "force-dynamic"

function ClaimTable({ claims, totals, names, empty }: { claims: Tables<"expense_claims">[]; totals: Map<string, number>; names?: Map<string, string>; empty: string }) {
  if (!claims.length) return <p className="rounded-xl border p-6 text-muted-foreground">{empty}</p>
  return <Table>
    <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Title</TableHead>{names && <TableHead>Employee</TableHead>}<TableHead>Status</TableHead><TableHead>Submitted</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
    <TableBody>{claims.map(claim => <TableRow key={claim.id}>
      <TableCell><Link className="font-medium hover:underline" href={`/expenses/${claim.id}`}>{claim.number}</Link></TableCell>
      <TableCell>{claim.title}</TableCell>
      {names && <TableCell>{names.get(claim.employee) ?? "Team member"}</TableCell>}
      <TableCell><StatusBadge status={claim.status} /></TableCell>
      <TableCell>{claim.submitted_at ? todayISO(new Date(claim.submitted_at)) : "—"}</TableCell>
      <TableCell className="text-right">{formatTHB(totals.get(claim.id) ?? 0)}</TableCell>
    </TableRow>)}</TableBody>
  </Table>
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, { mine, toApprove, totals, names }] = await Promise.all([searchParams, expenseClaimLists()])
  return <div className="space-y-6">
    <PageHeader title="Expenses" description="Claim out-of-pocket spending, get it approved and reimbursed."><Button render={<Link href="/expenses/new" />}>New claim</Button></PageHeader>
    <Tabs defaultValue={toApprove && tab === "approve" ? "approve" : "mine"} className="gap-4">
      <TabsList>
        <TabsTrigger value="mine">My claims</TabsTrigger>
        {toApprove && <TabsTrigger value="approve">To approve</TabsTrigger>}
      </TabsList>
      <TabsContent value="mine"><ClaimTable claims={mine} totals={totals} empty="No claims yet. Create one to get reimbursed." /></TabsContent>
      {toApprove && <TabsContent value="approve"><ClaimTable claims={toApprove} totals={totals} names={names} empty="Nothing waiting for your approval or payment." /></TabsContent>}
    </Tabs>
  </div>
}
