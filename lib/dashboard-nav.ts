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
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react"
import type { FeatureKey } from "@/lib/gates"

export type DashboardNavItem = {
  label: string
  href: string
  icon: LucideIcon
  /**
   * When set, the nav item is shown as locked for users who don't have
   * access to this feature. Clicking opens the upgrade modal rather than
   * navigating.
   */
  gate?: FeatureKey
  /** Render a subtle `hr` above this nav item (used on the feed skin to split primary vs. utility rows). */
  dividerAbove?: boolean
  /** Pin to the bottom of the sidebar (Settings, Help & Support). */
  footer?: boolean
}

/** Single source of truth for dashboard sidebar links (feed + all subpages). Profile lives in the header. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { label: "Feed",         href: "/dashboard",                           icon: LayoutGrid },
  { label: "Scout",        href: "/dashboard/scout",                     icon: Sparkles,   gate: "scout_actions" },
  { label: "Applications", href: "/dashboard/applications",              icon: ClipboardList },
  { label: "Resume",       href: "/dashboard/resume",                    icon: FileText,   gate: "resume_upload" },
  { label: "Cover letters",href: "/dashboard/cover-letters",             icon: Mails,      gate: "cover_letter" },
  { label: "Autofill",     href: "/dashboard/autofill",                  icon: Wand2,      gate: "autofill" },
  { label: "Watchlist",    href: "/dashboard/watchlist",                 icon: BookmarkCheck },
  { label: "Alerts",       href: "/dashboard/alerts",                    icon: Bell },
  { label: "Companies",    href: "/dashboard/companies",                 icon: Building2 },
  { label: "International",href: "/dashboard/international",             icon: Plane },
  { label: "Offer Risk",   href: "/dashboard/international/offer-risk",  icon: ShieldAlert, gate: "international" },
  { label: "Cohorts",      href: "/dashboard/cohorts",                   icon: Users,      gate: "scout_strategy" },
  { label: "Brand",        href: "/dashboard/brand",                     icon: TrendingUp, gate: "scout_strategy" },
  { label: "Fair Chance",  href: "/dashboard/background-check",          icon: ShieldCheck, gate: "scout_strategy" },
  { label: "Settings",     href: "/dashboard/billing",                   icon: Settings,   footer: true },
  { label: "Help & support", href: "mailto:support@hireoven.com",        icon: LifeBuoy,   footer: true },
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
