import { requireOrgContext } from "@/lib/auth"
import { WorkspaceHeader } from "@edition"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { ActivityCounter } from "@/components/record/activity-counter"
import { ThemeToggle } from "@/components/theme-toggle"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requireOrgContext()

  return (
    <SidebarProvider>
      <AppSidebar
        email={ctx.email}
        role={ctx.role}
        workspaceHeader={<WorkspaceHeader context={ctx} />}
      />
      {/* min-w-0: wide content (kanban boards) scrolls in its own container instead of widening the page. */}
      <SidebarInset className="min-w-0">
        <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-5" />
          <span className="text-sm font-medium">{ctx.orgName}</span>
          <ActivityCounter />
          <ThemeToggle />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
