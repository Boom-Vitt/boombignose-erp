import Link from "next/link"
import { ArrowLeft, Lock, PlugZap } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { AccountingConnectionForm } from "./_components/accounting-connection-form"

export const dynamic = "force-dynamic"

const PROVIDER_LABEL: Record<Enums<"accounting_provider">, string> = {
  flowaccount: "FlowAccount",
  peak: "PEAK",
  xero: "Xero",
}

const STATUS_META: Record<
  Enums<"accounting_conn_status">,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  connected: { label: "Connected", variant: "secondary" },
  disconnected: { label: "Not connected", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
}

export default async function AccountingSettingsPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const canEdit = ctx.role === "owner" || ctx.role === "admin"

  // Single row per org (org_id unique). May not exist yet.
  const { data: conn } = await supabase
    .from("accounting_connections")
    .select("provider, status, updated_at")
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  const status = conn?.status ?? "disconnected"
  const isConnected = status === "connected"
  const statusMeta = STATUS_META[status]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting sync"
        description="Connect your book-of-record to scaffold invoice syncing."
      >
        <Button variant="outline" render={<Link href="/settings" />}>
          <ArrowLeft /> Settings
        </Button>
      </PageHeader>

      <Alert>
        <PlugZap className="size-4" />
        <AlertTitle>Sync scaffold — not an accounting engine</AlertTitle>
        <AlertDescription>
          This maps invoices to your provider (FlowAccount, PEAK or Xero) and
          records the mapping. It does not create tax invoices or compute VAT,
          and the live push is stubbed in this build.
        </AlertDescription>
      </Alert>

      <Card className="max-w-2xl">
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Connection</CardTitle>
            <CardDescription>
              {isConnected && conn
                ? `Syncing to ${PROVIDER_LABEL[conn.provider]}.`
                : "No accounting provider connected yet."}
            </CardDescription>
          </div>
          <Badge variant={statusMeta.variant} className="shrink-0">
            {statusMeta.label}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {conn ? (
            <dl className="divide-y text-sm">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="font-medium">
                  {PROVIDER_LABEL[conn.provider]}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">{statusMeta.label}</dd>
              </div>
            </dl>
          ) : null}

          {canEdit ? (
            <AccountingConnectionForm
              connectedProvider={isConnected && conn ? conn.provider : null}
            />
          ) : (
            <Alert>
              <Lock className="size-4" />
              <AlertTitle>View only</AlertTitle>
              <AlertDescription>
                Only an owner or admin can change the accounting connection.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
