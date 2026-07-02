import {
  LayoutDashboard,
  Users,
  Handshake,
  FileText,
  FolderKanban,
  Clock,
  Receipt,
  BarChart3,
  CalendarDays,
  Sparkles,
  NotebookPen,
  Workflow,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** Hide from members in the sidebar (page is also role-gated server-side). */
  ownerAdminOnly?: boolean
}

/**
 * Single source of truth for the app's primary navigation and routes.
 * Every module route is registered here so the sidebar stays in sync.
 */
export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Clients", href: "/clients", icon: Users },
  { title: "Deals", href: "/deals", icon: Handshake },
  { title: "Quotes", href: "/quotes", icon: FileText },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Timesheets", href: "/timesheets", icon: Clock },
  { title: "Finance", href: "/finance", icon: Receipt },
  { title: "Reports", href: "/reports", icon: BarChart3 },
  { title: "Calendar", href: "/calendar", icon: CalendarDays },
  { title: "Templates", href: "/templates", icon: Sparkles },
  { title: "Intake", href: "/intake", icon: NotebookPen },
  { title: "Automation", href: "/automation", icon: Workflow },
  { title: "Activity", href: "/audit", icon: ScrollText, ownerAdminOnly: true },
  { title: "Settings", href: "/settings", icon: Settings },
]
