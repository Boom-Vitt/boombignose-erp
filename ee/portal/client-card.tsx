import { Share2 } from "lucide-react"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PortalShareCard } from "./components/portal-share-card"

export async function ClientPortalCard({ clientId }: { clientId: string }) {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "settings:manage")) return null
  const supabase = await createClient()
  const { data: client, error } = await supabase.from("clients")
    .select("portal_enabled, portal_token").eq("org_id", ctx.orgId).eq("id", clientId).maybeSingle()
  if (error) throw new Error("Unable to load client portal settings.")
  if (!client) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Share2 className="size-4" /> Client portal</CardTitle>
      </CardHeader>
      <CardContent>
        <PortalShareCard clientId={clientId} portalEnabled={client.portal_enabled}
          portalToken={client.portal_token} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />
      </CardContent>
    </Card>
  )
}
