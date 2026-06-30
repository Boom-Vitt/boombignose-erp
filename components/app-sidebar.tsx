"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut, Sparkles } from "lucide-react"

import { NAV_ITEMS } from "@/components/nav"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

export function AppSidebar({
  email,
  role,
  orgName,
}: {
  email: string | null
  role: string
  orgName: string
}) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
            <Sparkles className="size-4" />
          </div>
          <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">{orgName}</span>
            <span className="text-muted-foreground text-xs">Company OS</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">
              {(email ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-medium">{email ?? "—"}</span>
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
              {role}
            </span>
          </div>
          <form
            action="/auth/signout"
            method="post"
            className="group-data-[collapsible=icon]:hidden"
          >
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
              <LogOut />
            </Button>
          </form>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
