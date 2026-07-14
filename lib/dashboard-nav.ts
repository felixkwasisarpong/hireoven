import type { LucideIcon } from "lucide-react"
import {
  Bell,
  BookmarkCheck,
  Briefcase,
  ClipboardList,
  FileText,
  Gauge,
  Gift,
  Globe,
  GraduationCap,
  LayoutGrid,
  LifeBuoy,
  Mails,
  MessageCircle,
  Mic,
  Plane,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Triangle,
  Trophy,
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
  /** Use exact-path matching for active detection. Set this when the item's
   *  href is also a prefix of sibling items (e.g. /dashboard/international
   *  vs /dashboard/international/offer-risk). */
  exact?: boolean
}

export type DashboardNavGroup = {
  label: string
  icon: LucideIcon
}

export const NAV_GROUPS: Record<string, DashboardNavGroup> = {
  "Search & Apply": { label: "Search & Apply", icon: Briefcase  },
  "Documents":      { label: "Documents",      icon: FileText   },
  "Grow":           { label: "Grow",           icon: TrendingUp },
  "International":   { label: "International",   icon: Globe      },
}

/** Single source of truth for dashboard sidebar links. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  // ── Front door: the two hubs everything else feeds into ──────────────────────
  { label: "Feed",           href: "/dashboard",                          icon: LayoutGrid },
  { label: "Apex",          href: "/dashboard/apex",                    icon: Triangle,   gate: "apex_actions", subtitle: "Your AI job-search copilot" },

  // ── Search & Apply ───────────────────────────────────────────────────────────
  { label: "Watchlist",      href: "/dashboard/watchlist",                icon: BookmarkCheck, group: "Search & Apply", subtitle: "Jobs you've saved" },
  { label: "Alerts",         href: "/dashboard/alerts",                   icon: Bell,          group: "Search & Apply", subtitle: "New-match notifications" },
  { label: "Applications",   href: "/dashboard/applications",             icon: ClipboardList, group: "Search & Apply", subtitle: "Track your pipeline" },
  { label: "Autofill",       href: "/dashboard/autofill",                 icon: Wand2,         group: "Search & Apply", gate: "autofill", subtitle: "One-click applications" },
  { label: "Outreach",       href: "/dashboard/outreach",                 icon: Send,          group: "Search & Apply", gate: "apex_strategy", subtitle: "Reach recruiters & hiring managers" },

  // ── Documents ────────────────────────────────────────────────────────────────
  { label: "Resume",         href: "/dashboard/resume",                   icon: FileText,        group: "Documents", gate: "resume_upload", subtitle: "Build & tailor resumes" },
  { label: "Cover letters",  href: "/dashboard/cover-letters",            icon: Mails,           group: "Documents", gate: "cover_letter", subtitle: "Generate cover letters" },

  // ── Grow ─────────────────────────────────────────────────────────────────────
  { label: "Interview",      href: "/dashboard/interview",                icon: Mic,            group: "Grow", subtitle: "Practice & prep with AI" },
  { label: "Skill Gaps",     href: "/dashboard/grow/skills",              icon: GraduationCap,  group: "Grow", subtitle: "Learn what unlocks more roles" },
  { label: "Scorecard",      href: "/dashboard/scorecard",                icon: Gauge,          group: "Grow", subtitle: "Your sponsorability score" },
  { label: "Cohorts",        href: "/dashboard/cohorts",                  icon: Users,       group: "Grow", gate: "apex_strategy", subtitle: "Peers on the same path" },
  { label: "Brand",          href: "/dashboard/brand",                    icon: TrendingUp,  group: "Grow", gate: "apex_strategy", subtitle: "Grow your LinkedIn presence" },
  { label: "Fair Chance",    href: "/dashboard/background-check",         icon: ShieldCheck, group: "Grow", gate: "apex_strategy", subtitle: "Second-chance-friendly roles" },

  // ── International ────────────────────────────────────────────────────────────
  // No gate — pages enforce the profile check (is_international / visa_status)
  { label: "International",  href: "/dashboard/international",            icon: Plane,           group: "International", subtitle: "Tools for visa seekers", exact: true },
  { label: "H-1B Intel",     href: "/dashboard/international/h1b-explorer", icon: Globe,         group: "International", subtitle: "Visa sponsorship data" },
  { label: "H-1B Sponsors",  href: "/h1b-sponsors/leaderboard",           icon: Trophy,          group: "International", subtitle: "Public sponsor leaderboard" },
  { label: "Offer Risk",     href: "/dashboard/international/offer-risk", icon: ShieldAlert,     group: "International", subtitle: "Vet an offer's stability" },
  // Hidden for now — page/routes remain at /dashboard/international/services.
  // { label: "Immigration Services", href: "/dashboard/international/services", icon: Scale,    group: "International", subtitle: "Book vetted attorneys & doc prep" },

  // ── Footer ───────────────────────────────────────────────────────────────────
  { label: "Refer a friend", href: "/dashboard/referrals",               icon: Gift,          footer: true },
  { label: "Billing",        href: "/dashboard/billing",                  icon: Settings,      footer: true },
  { label: "Feedback",       href: "#feedback",                           icon: MessageCircle, footer: true, action: "feedback" },
  { label: "Help & support", href: "mailto:support@hireoven.com",         icon: LifeBuoy,      footer: true },
]

export function isDashboardNavActive(pathname: string, href: string, exact?: boolean): boolean {
  if (href.startsWith("mailto:") || href.startsWith("http://") || href.startsWith("https://")) {
    return false
  }
  if (href === "/dashboard" || exact) {
    return pathname === href
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
