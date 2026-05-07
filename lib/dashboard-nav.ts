import type { LucideIcon } from "lucide-react"
import {
  BarChart2,
  Bell,
  BookmarkCheck,
  Briefcase,
  Building2,
  ClipboardList,
  FileText,
  Globe,
  LayoutGrid,
  LifeBuoy,
  Mails,
  Plane,
  Search,
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
  gate?: FeatureKey
  dividerAbove?: boolean
  footer?: boolean
  /** Group key — items sharing a key are rendered under a collapsible section. */
  group?: string
}

export type DashboardNavGroup = {
  label: string
  icon: LucideIcon
}

export const NAV_GROUPS: Record<string, DashboardNavGroup> = {
  "My Career":     { label: "My Career",     icon: Briefcase },
  "Research":      { label: "Research",      icon: Search    },
  "International": { label: "International", icon: Globe     },
  "Insights":      { label: "Insights",      icon: BarChart2 },
}

/** Single source of truth for dashboard sidebar links. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  // ── Top level ───────────────────────────────────────────────────────────────
  { label: "Feed",           href: "/dashboard",                          icon: LayoutGrid },
  { label: "Scout",          href: "/dashboard/scout",                    icon: Sparkles,   gate: "scout_actions" },

  // ── My Career ───────────────────────────────────────────────────────────────
  { label: "Applications",   href: "/dashboard/applications",             icon: ClipboardList,  group: "My Career" },
  { label: "Resume",         href: "/dashboard/resume",                   icon: FileText,        group: "My Career", gate: "resume_upload" },
  { label: "Cover letters",  href: "/dashboard/cover-letters",            icon: Mails,           group: "My Career", gate: "cover_letter" },
  { label: "Autofill",       href: "/dashboard/autofill",                 icon: Wand2,           group: "My Career", gate: "autofill" },

  // ── Research ─────────────────────────────────────────────────────────────────
  { label: "Watchlist",      href: "/dashboard/watchlist",                icon: BookmarkCheck,   group: "Research" },
  { label: "Alerts",         href: "/dashboard/alerts",                   icon: Bell,            group: "Research" },
  { label: "Companies",      href: "/dashboard/companies",                icon: Building2,       group: "Research" },

  // ── International ────────────────────────────────────────────────────────────
  { label: "International",  href: "/dashboard/international",            icon: Plane,           group: "International" },
  { label: "Offer Risk",     href: "/dashboard/international/offer-risk", icon: ShieldAlert,     group: "International", gate: "international" },

  // ── Insights ─────────────────────────────────────────────────────────────────
  { label: "Cohorts",        href: "/dashboard/cohorts",                  icon: Users,           group: "Insights", gate: "scout_strategy" },
  { label: "Brand",          href: "/dashboard/brand",                    icon: TrendingUp,      group: "Insights", gate: "scout_strategy" },
  { label: "Fair Chance",    href: "/dashboard/background-check",         icon: ShieldCheck,     group: "Insights", gate: "scout_strategy" },

  // ── Footer ───────────────────────────────────────────────────────────────────
  { label: "Settings",       href: "/dashboard/billing",                  icon: Settings,   footer: true },
  { label: "Help & support", href: "mailto:support@hireoven.com",         icon: LifeBuoy,   footer: true },
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
