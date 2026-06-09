import type { LucideIcon } from "lucide-react"
import {
  BarChart2,
  Bell,
  BookmarkCheck,
  Briefcase,
  ClipboardList,
  FileText,
  Globe,
  LayoutGrid,
  LifeBuoy,
  Mails,
  MessageCircle,
  Mic,
  Plane,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Triangle,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react"
import type { FeatureKey } from "@/lib/gates"

/** Named actions that NavItem renders as a button instead of a link.
 *  When `action` is set, `href` is ignored (use "#" as a placeholder). */
export type DashboardNavAction = "feedback"

export type DashboardNavItem = {
  label: string
  href: string
  icon: LucideIcon
  /** Plain-language one-liner shown under the label to demystify product-named
   *  destinations (Apex, Cohorts, Fair Chance…). Omit for self-evident items. */
  subtitle?: string
  gate?: FeatureKey
  dividerAbove?: boolean
  footer?: boolean
  /** Group key — items sharing a key are rendered under a collapsible section. */
  group?: string
  /** If set, clicking the item triggers a named in-app action instead of
   *  navigating. The sidebar maps these to the right context handler. */
  action?: DashboardNavAction
}

export type DashboardNavGroup = {
  label: string
  icon: LucideIcon
}

export const NAV_GROUPS: Record<string, DashboardNavGroup> = {
  "My Career":     { label: "My Career",     icon: Briefcase },
  "International": { label: "International", icon: Globe     },
  "Insights":      { label: "Insights",      icon: BarChart2 },
}

/** Single source of truth for dashboard sidebar links. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  // ── Top level ───────────────────────────────────────────────────────────────
  { label: "Feed",           href: "/dashboard",                          icon: LayoutGrid },
  { label: "Apex",          href: "/dashboard/apex",                    icon: Triangle,   gate: "apex_actions", subtitle: "Your AI job-search copilot" },
  { label: "Interview",      href: "/dashboard/interview",                icon: Mic,         subtitle: "Practice & prep with AI" },
  { label: "Watchlist",      href: "/dashboard/watchlist",                icon: BookmarkCheck, subtitle: "Jobs you've saved" },
  { label: "Alerts",         href: "/dashboard/alerts",                   icon: Bell },
  { label: "H-1B Intel",     href: "/dashboard/international/h1b-explorer", icon: Plane,      subtitle: "Visa sponsorship data" },
  { label: "Cohorts",        href: "/dashboard/cohorts",                  icon: Users,      gate: "apex_strategy", subtitle: "Peers on the same path" },
  { label: "Fair Chance",    href: "/dashboard/background-check",         icon: ShieldCheck, gate: "apex_strategy", subtitle: "Second-chance-friendly roles" },
  { label: "Brand",          href: "/dashboard/brand",                    icon: TrendingUp, gate: "apex_strategy", subtitle: "Grow your LinkedIn presence" },

  // ── My Career ───────────────────────────────────────────────────────────────
  { label: "Applications",   href: "/dashboard/applications",             icon: ClipboardList,  group: "My Career", subtitle: "Track your pipeline" },
  { label: "Resume",         href: "/dashboard/resume",                   icon: FileText,        group: "My Career", gate: "resume_upload", subtitle: "Build & tailor resumes" },
  { label: "Cover letters",  href: "/dashboard/cover-letters",            icon: Mails,           group: "My Career", gate: "cover_letter" },
  { label: "Autofill",       href: "/dashboard/autofill",                 icon: Wand2,           group: "My Career", gate: "autofill", subtitle: "One-click applications" },

  // ── International ────────────────────────────────────────────────────────────
  // No gate — pages enforce the profile check (is_international / visa_status)
  { label: "International",  href: "/dashboard/international",            icon: Plane,           group: "International", subtitle: "Tools for visa seekers" },
  { label: "Offer Risk",     href: "/dashboard/international/offer-risk", icon: ShieldAlert,     group: "International", subtitle: "Vet an offer's stability" },

  // ── Footer ───────────────────────────────────────────────────────────────────
  { label: "Settings",       href: "/dashboard/billing",                  icon: Settings,      footer: true },
  { label: "Feedback",       href: "#feedback",                           icon: MessageCircle, footer: true, action: "feedback" },
  { label: "Help & support", href: "mailto:support@hireoven.com",         icon: LifeBuoy,      footer: true },
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
