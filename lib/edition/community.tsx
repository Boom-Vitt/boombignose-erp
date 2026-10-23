import { notFound } from "next/navigation"
import { Sparkles } from "lucide-react"
import type { ComponentType } from "react"
import type { WorkspaceHeaderProps, PortalPageProps, InvoiceAccounting, InvoiceAccountingControlsProps, InvoiceAccountingStatusProps } from "./types"

export { createFirstWorkspace as createWorkspace } from "@/app/onboarding/actions"

export function WorkspaceHeader({ context }: WorkspaceHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md"><Sparkles className="size-4" /></div>
      <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-semibold">{context.orgName}</span>
        <span className="text-muted-foreground text-xs">ERP</span>
      </div>
    </div>
  )
}

export const ClientPortalCard: ComponentType<{ clientId: string }> = () => null
export const AccountingIntegrationCard = () => null
export const InvoiceAccountingControls: ComponentType<InvoiceAccountingControlsProps> = () => null
export const InvoiceAccountingStatus: ComponentType<InvoiceAccountingStatusProps> = () => null
export const getInvoiceAccounting: (orgId: string, invoiceId: string) => Promise<InvoiceAccounting> = async () => ({ connected: false, sync: null })
export const PortalPage: ComponentType<PortalPageProps> = () => notFound()
export const AccountingSettingsPage = () => notFound()
