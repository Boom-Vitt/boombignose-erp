import Link from "next/link"

import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { addLostReason, setLostReasonActive } from "./actions"

export const dynamic = "force-dynamic"

const ERRORS: Record<string, string> = {
  invalid: "Enter a reason of 1 to 80 characters.",
  duplicate: "That reason is already on the list.",
  save: "Unable to save the reason. Please try again.",
}

export default async function LostReasonsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const supabase = await createClient()
  const { data: reasons, error: loadError } = await supabase
    .from("deal_lost_reasons")
    .select("id,name,active")
    .eq("org_id", ctx.orgId)
    .order("active", { ascending: false })
    .order("name")
  if (loadError) throw new Error("Unable to load lost reasons. Please try again.")
  const { error } = await searchParams

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lost reasons"
        description="The choices offered when a deal is marked lost."
        breadcrumbs={[{ label: "Deals", href: "/deals" }]}
      />
      {error ? <p role="alert" className="text-destructive">{ERRORS[error] ?? ERRORS.save}</p> : null}
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle><h2>Add a reason</h2></CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addLostReason} className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="reason-name">Reason</Label>
              <Input id="reason-name" name="name" required maxLength={80} autoComplete="off" />
            </div>
            <button type="submit" className={buttonVariants()}>Add</button>
          </form>
        </CardContent>
      </Card>
      <Card className="max-w-xl">
        <CardContent>
          {reasons.length ? (
            <ul className="divide-y">
              {reasons.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span className={r.active ? undefined : "text-muted-foreground line-through"}>
                    {r.name}
                    {r.active ? null : <span className="sr-only"> (archived)</span>}
                  </span>
                  <form action={setLostReasonActive}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="active" value={r.active ? "false" : "true"} />
                    <button
                      type="submit"
                      aria-label={`${r.active ? "Archive" : "Restore"} ${r.name}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      {r.active ? "Archive" : "Restore"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No lost reasons yet.</p>
          )}
        </CardContent>
      </Card>
      <Link href="/deals" className="text-sm underline">Back to deals</Link>
    </div>
  )
}
