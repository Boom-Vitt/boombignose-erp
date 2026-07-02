"use client"

import { useTransition } from "react"
import { Check, ChevronsUpDown, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { setActiveOrg } from "@/app/(app)/settings/org-actions"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export type OrgOption = { orgId: string; orgName: string; role: string }

/**
 * Sidebar workspace switcher. Renders a dropdown of the user's orgs; selecting
 * one calls the `setActiveOrg` server action (which sets the active-org cookie
 * and redirects to the dashboard). With a single org it stays a plain label.
 */
export function OrgSwitcher({
  orgs,
  currentOrgId,
}: {
  orgs: OrgOption[]
  currentOrgId: string
}) {
  const [pending, startTransition] = useTransition()
  const current =
    orgs.find((o) => o.orgId === currentOrgId) ?? orgs[0] ?? null
  const currentName = current?.orgName ?? "Workspace"

  function switchTo(orgId: string) {
    if (orgId === currentOrgId) return
    startTransition(async () => {
      const res = await setActiveOrg({ orgId })
      if (res?.error) toast.error(res.error)
    })
  }

  const Brand = (
    <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
      <Sparkles className="size-4" />
    </div>
  )

  if (orgs.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-1 py-1.5">
        {Brand}
        <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-semibold">{currentName}</span>
          <span className="text-muted-foreground text-xs">Company OS</span>
        </div>
      </div>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                disabled={pending}
                className="data-[state=open]:bg-sidebar-accent"
              />
            }
          >
            {Brand}
            <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-semibold">
                {currentName}
              </span>
              <span className="text-muted-foreground text-xs">
                Switch workspace
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((o) => (
              <DropdownMenuItem
                key={o.orgId}
                onClick={() => switchTo(o.orgId)}
                className="gap-2"
              >
                <span className="flex-1 truncate">{o.orgName}</span>
                {o.orgId === currentOrgId ? (
                  <Check className="size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
