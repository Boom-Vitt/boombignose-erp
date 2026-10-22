import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { updateDealStage } from "../actions"
import { MarkWonButton } from "./mark-won-button"

/** On an accepted quote, offers to close its still-open deal as won. */
export async function DealWonOffer({ quoteId }: { quoteId: string }) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data: quote } = await supabase
    .from("quotes")
    .select("status, deal:deals!quotes_deal_tenant_fkey(id,title,stage)")
    .eq("org_id", ctx.orgId)
    .eq("id", quoteId)
    .maybeSingle()
  const deal = quote?.deal
  if (!deal || deal.stage === "won" || (quote.status !== "accepted" && quote.status !== "converted")) return null

  const dealId = deal.id
  async function markWon() {
    "use server"
    return updateDealStage(dealId, "won")
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
      <p className="me-auto">
        This quote is accepted. Mark the deal{" "}
        <Link href={`/deals/${dealId}`} className="font-medium underline-offset-4 hover:underline">
          {deal.title}
        </Link>{" "}
        as won?
      </p>
      <MarkWonButton onMarkWon={markWon} />
    </div>
  )
}
