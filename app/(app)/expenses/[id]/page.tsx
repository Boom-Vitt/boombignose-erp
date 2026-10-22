import { notFound } from "next/navigation"
import { z } from "zod"
import { FolderKanban, Receipt } from "lucide-react"
import { expenseDetail, expenseProjects } from "@/lib/expenses/queries"
import { claimFlow } from "@/lib/expenses/flow"
import { todayISO } from "@/lib/dates"
import { formatTHB, sumSatang } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons } from "@/components/record/smart-buttons"
import { RecordHistory } from "@/components/record/record-history"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PurchaseAction } from "@/app/(app)/purchases/_components/action-button"
import { removeExpenseLine, transitionExpenseClaim } from "../actions"
import { ExpenseLineForm } from "../_components/line-form"
import { RejectDialog } from "../_components/reject-dialog"

export const dynamic = "force-dynamic"

const day = (instant: string | null) => instant ? todayISO(new Date(instant)) : "—"

export default async function ExpenseClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const { ctx, claim, lines, costCount, names } = await expenseDetail(id)
  const editable = claim.status === "draft" && claim.employee === ctx.userId
  const projects = editable ? await expenseProjects() : []
  const projectIds = [...new Set(lines.flatMap(line => line.project_id ? [line.project_id] : []))]
  const onlyProject = projectIds.length === 1 ? lines.find(line => line.project_id === projectIds[0]) : undefined
  return <div className="space-y-6">
    <PageHeader title={claim.number} description={claim.title} breadcrumbs={[{ label: "Expenses", href: "/expenses" }]} />
    <StatusBar label="Expense status" flow={claimFlow(claim, ctx)} status={claim.status} transition={transitionExpenseClaim.bind(null, id)}
      commands={{ reject: ({ label, variant }) => <RejectDialog claimId={id} label={label} variant={variant} /> }} />
    <SmartButtons buttons={[
      { label: "Costs", icon: Receipt, href: "/finance?tab=costs", count: costCount },
      { label: onlyProject ? "Project" : "Projects", icon: FolderKanban, href: onlyProject ? `/projects/${onlyProject.project_id}` : "/projects", count: projectIds.length, value: onlyProject?.projects?.name },
    ]} />
    {claim.status === "rejected" && <Alert variant="destructive"><AlertTitle>Rejected by {names.get(claim.decided_by ?? "") ?? "an approver"}</AlertTitle><AlertDescription className="whitespace-pre-wrap">{claim.decision_note}</AlertDescription></Alert>}
    <dl className="grid gap-4 rounded-xl border p-5 sm:grid-cols-3">
      <div><dt className="text-sm text-muted-foreground">Employee</dt><dd>{names.get(claim.employee) ?? "Team member"}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Submitted</dt><dd>{day(claim.submitted_at)}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Total</dt><dd className="font-semibold">{formatTHB(sumSatang(lines.map(line => line.amount_satang)))}</dd></div>
      {claim.decided_by && <div><dt className="text-sm text-muted-foreground">Decided by</dt><dd>{names.get(claim.decided_by) ?? "Team member"} on {day(claim.decided_at)}</dd></div>}
      {claim.paid_at && <div><dt className="text-sm text-muted-foreground">Paid</dt><dd>{day(claim.paid_at)}</dd></div>}
    </dl>
    <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead>Project</TableHead><TableHead className="text-right">Amount</TableHead>{editable && <TableHead>Actions</TableHead>}</TableRow></TableHeader>
      <TableBody>{lines.map(line => <TableRow key={line.id}>
        <TableCell>{line.spent_on}</TableCell><TableCell className="capitalize">{line.category}</TableCell><TableCell>{line.description}</TableCell><TableCell>{line.projects?.name ?? "—"}</TableCell>
        <TableCell className="text-right">{formatTHB(line.amount_satang)}</TableCell>
        {editable && <TableCell><PurchaseAction action={removeExpenseLine.bind(null, id, line.id)} label={`Remove ${line.description}`} /></TableCell>}
      </TableRow>)}</TableBody>
    </Table>
    {!lines.length && <p className="text-sm text-muted-foreground">Add at least one line before submitting.</p>}
    {editable && <ExpenseLineForm claimId={id} today={todayISO()} projects={projects} />}
    {editable && <p className="text-sm text-muted-foreground">Attach receipts in the record history below.</p>}
    <RecordHistory recordType="expense_claim" recordId={id} />
  </div>
}
