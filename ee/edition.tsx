import type { WorkspaceHeaderProps } from "@/lib/edition/types"
import { getUserOrgs } from "./workspaces/queries"
import { OrgSwitcher } from "./workspaces/components/org-switcher"

export { provisionWorkspace as createWorkspace } from "./workspaces/actions"
export { ClientPortalCard } from "./portal/client-card"
export { default as PortalPage } from "./portal/page"
export { AccountingIntegrationCard } from "./accounting/integration-card"
export { default as AccountingSettingsPage } from "./accounting/settings-page"
export { getInvoiceAccounting, InvoiceAccountingControls, InvoiceAccountingStatus } from "./accounting/invoice-sync"

export async function WorkspaceHeader({ context }: WorkspaceHeaderProps) {
  return <OrgSwitcher orgs={await getUserOrgs()} currentOrgId={context.orgId} />
}
