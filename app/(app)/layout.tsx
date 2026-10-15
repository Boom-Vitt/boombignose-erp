import { requireOrgContext, getUserOrgs } from "@/lib/auth"
import { AppSidebar } from "@/components/app-sidebar"
import {
  AppViewShell,
  ViewModeProvider,
} from "@/components/view-mode"
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requireOrgContext()
  const orgs = await getUserOrgs()

  return (
    <ViewModeProvider>
      <SidebarProvider>
        <AppViewShell
          sidebar={
            <AppSidebar
              email={ctx.email}
              role={ctx.role}
              orgs={orgs}
              currentOrgId={ctx.orgId}
            />
          }
          toolbarLeft={
            <>
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-1 h-5" />
              <span className="text-sm font-medium">{ctx.orgName}</span>
            </>
          }
        >
          {children}
        </AppViewShell>
      </SidebarProvider>
    </ViewModeProvider>
  )
}
