import type { LucideIcon } from "lucide-react"
import {
  BookmarkCheck,
  Briefcase,
  ClipboardList,
  FileText,
  Gauge,
  Gift,
  Globe,
  LayoutGrid,
  LifeBuoy,
  MessageCircle,
  Mic,
  Moon,
  Plane,
  Search,
  Send,
  Settings,
  Triangle,
  TrendingUp,
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
  { label: "Watchlist",      href: "/dashboard/watchlist",                icon: BookmarkCheck, group: "Search & Apply", subtitle: "Companies you're tracking" },
  { label: "Site Scout",     href: "/dashboard/site-scout",               icon: Search,        group: "Search & Apply", gate: "apex_actions", subtitle: "Scan external career sites" },
  // Alerts (saved searches) moved into notification settings — reach them from
  // Settings -> Job alerts (D6). Route remains at /dashboard/alerts.
  { label: "Applications",   href: "/dashboard/applications",             icon: ClipboardList, group: "Search & Apply", subtitle: "Track your pipeline" },
  // Sits directly under Applications because that is what it produces. It was
  // reachable only from the account dropdown, next to email preferences, which
  // is nowhere near where anyone would look for the headline Pro Max feature —
  // and the page also holds the questions that block applications, so a user who
  // cannot find it cannot unblock their own run.
  { label: "Auto-apply",     href: "/dashboard/auto-apply",               icon: Moon,          group: "Search & Apply", gate: "apex_actions", subtitle: "Applications sent while you sleep" },
  // D8: this route IS the profile (personal info, work auth, experience, EEO) —
  // relabel to "Profile". Route stays /dashboard/autofill because the shipped
  // Chrome extension hard-codes that path (chrome.tabs.create, easy-apply);
  // /dashboard/profile redirects here for the intuitive URL.
  { label: "Profile",        href: "/dashboard/autofill",                 icon: Wand2,         group: "Search & Apply", gate: "autofill", subtitle: "Your details for one-click applications" },
  { label: "Outreach",       href: "/dashboard/outreach",                 icon: Send,          group: "Search & Apply", gate: "apex_strategy", subtitle: "Reach recruiters & hiring managers" },

  // ── Documents ────────────────────────────────────────────────────────────────
  // Positioning, Career pivot, Cover letters and Skill Gaps are now tabs inside
  // the Resume hub (D3); old routes 301-redirect (D4). One sidebar entry.
  { label: "Resume",         href: "/dashboard/resume",                   icon: FileText,        group: "Documents", gate: "resume_upload", subtitle: "Build, tailor, position & pivot" },

  // ── Grow ─────────────────────────────────────────────────────────────────────
  { label: "Interview",      href: "/dashboard/interview",                icon: Mic,            group: "Grow", subtitle: "Practice & prep with AI" },
  { label: "Scorecard",      href: "/dashboard/scorecard",                icon: Gauge,          group: "Grow", subtitle: "Your sponsorability score" },
  // Parked (D7) — Cohorts / Brand / Fair Chance are built and functional but are
  // arguably separate products; removed from the sidebar to reduce sprawl. Routes
  // remain (/dashboard/cohorts, /dashboard/brand, /dashboard/background-check) so
  // nothing is deleted and any existing data/deep links still work. Reversible:
  // uncomment to restore.
  // { label: "Cohorts",        href: "/dashboard/cohorts",                  icon: Users,       group: "Grow", gate: "apex_strategy", subtitle: "Peers on the same path" },
  // { label: "Brand",          href: "/dashboard/brand",                    icon: TrendingUp,  group: "Grow", gate: "apex_strategy", subtitle: "Grow your LinkedIn presence" },
  // { label: "Fair Chance",    href: "/dashboard/background-check",         icon: ShieldCheck, group: "Grow", gate: "apex_strategy", subtitle: "Second-chance-friendly roles" },

  // ── International ────────────────────────────────────────────────────────────
  // No gate — pages enforce the profile check (is_international / visa_status)
  // D2: sponsorship is one feature, not a section. Collapse to a single
  // "International" entry — the hub page surfaces LCA Explorer, Offer Risk, the
  // Sponsor Leaderboard and OPT Survival as tiles. Sub-routes are unchanged.
  { label: "International",  href: "/dashboard/international",            icon: Plane,           group: "International", subtitle: "Visa & sponsorship tools", exact: true },
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
