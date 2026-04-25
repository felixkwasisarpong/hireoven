import type { LucideIcon } from "lucide-react"
import {
  Bell,
  BookmarkCheck,
  Building2,
  ClipboardList,
  FileText,
  LayoutGrid,
  LifeBuoy,
  Mails,
  Plane,
  Settings,
  Wand2,
} from "lucide-react"

export type DashboardNavItem = {
  label: string
  href: string
  icon: LucideIcon
  /** Render a subtle `hr` above this nav item (used on the feed skin to split primary vs. utility rows). */
  dividerAbove?: boolean
}

/** Single source of truth for dashboard sidebar links (feed + all subpages). Profile lives in the header. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { label: "Feed", href: "/dashboard", icon: LayoutGrid },
  { label: "Applications", href: "/dashboard/applications", icon: ClipboardList },
  { label: "Resume", href: "/dashboard/resume", icon: FileText },
  { label: "Cover letters", href: "/dashboard/cover-letters", icon: Mails },
  { label: "Autofill", href: "/dashboard/autofill", icon: Wand2 },
  { label: "Watchlist", href: "/dashboard/watchlist", icon: BookmarkCheck },
  { label: "Alerts", href: "/dashboard/alerts", icon: Bell },
  { label: "Companies", href: "/dashboard/companies", icon: Building2 },
  { label: "International", href: "/dashboard/international", icon: Plane },
  { label: "Settings", href: "/dashboard/billing", icon: Settings, dividerAbove: true },
  {
    label: "Help & support",
    href: "mailto:support@hireoven.com",
    icon: LifeBuoy,
  },
]

export function isDashboardNavActive(pathname: string, href: string): boolean {
  if (href.startsWith("mailto:") || href.startsWith("http://") || href.startsWith("https://")) {
    return false
  }
  if (href === "/dashboard") {
    return pathname === href
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
