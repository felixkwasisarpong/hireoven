import type { LucideIcon } from "lucide-react"
import {
  Bell,
  BookmarkCheck,
  Building2,
  ClipboardList,
  FileText,
  LayoutGrid,
  Mails,
  Sparkles,
  Wand2,
} from "lucide-react"

/** Single source of truth for dashboard sidebar links (feed + all subpages). Profile lives in the header. */
export const DASHBOARD_NAV_ITEMS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Feed", href: "/dashboard", icon: LayoutGrid },
  { label: "Applications", href: "/dashboard/applications", icon: ClipboardList },
  { label: "Companies", href: "/dashboard/companies", icon: Building2 },
  { label: "Resume", href: "/dashboard/resume", icon: FileText },
  { label: "Cover letters", href: "/dashboard/cover-letters", icon: Mails },
  { label: "Autofill", href: "/dashboard/autofill", icon: Wand2 },
  { label: "Watchlist", href: "/dashboard/watchlist", icon: BookmarkCheck },
  { label: "Alerts", href: "/dashboard/alerts", icon: Bell },
]

export function isDashboardNavActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
