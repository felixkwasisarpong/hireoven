import type { LucideIcon } from "lucide-react"
import {
  Activity,
  BarChart3,
  Bookmark,
  Building2,
  CalendarClock,
  FileCheck2,
  Scale,
  Shield,
  Sparkles,
  Target,
  Wand2,
  Zap,
} from "lucide-react"

/** Core product — benefit-first, used on home + /features */
export const CORE_FEATURES: {
  icon: LucideIcon
  title: string
  body: string
  accent: string
  ring: string
}[] = [
  {
    icon: Zap,
    title: "Fresh jobs, before the crowd",
    body: "New roles land in your feed within minutes of going live. The first handful of applicants get the most eyes—we make sure you're in it.",
    accent: "text-[#0369A1]",
    ring: "border-[#BAE6FD] bg-[#F0F9FF]",
  },
  {
    icon: Target,
    title: "AI match scores on every role",
    body: "Only see roles that actually fit your resume, seniority, and location. Low-fit postings are filtered out before you ever scroll past them.",
    accent: "text-violet-700",
    ring: "border-violet-200 bg-violet-50",
  },
  {
    icon: Wand2,
    title: "One-click apply, done",
    body: "Greenhouse, Lever, Ashby, Workday—our autofill handles the tedious fields so you ship applications in seconds, not minutes.",
    accent: "text-emerald-700",
    ring: "border-emerald-200 bg-emerald-50",
  },
  {
    icon: FileCheck2,
    title: "Resume gap analysis",
    body: "Paste a role, get a prioritized list of what's missing from your resume to hit the bar. Fix the weak spots before you apply.",
    accent: "text-amber-700",
    ring: "border-amber-200 bg-amber-50",
  },
  {
    icon: Sparkles,
    title: "Tailored cover letters",
    body: "Generate a cover letter tuned to the exact role and company in under 30 seconds. Edit freely, ship confidently.",
    accent: "text-fuchsia-700",
    ring: "border-fuchsia-200 bg-fuchsia-50",
  },
  {
    icon: Bookmark,
    title: "Watchlist + instant alerts",
    body: "Follow companies you love. The moment they post, you hear about it—email, push, or right inside your dashboard.",
    accent: "text-rose-700",
    ring: "border-rose-200 bg-rose-50",
  },
]

/** International & intelligence — one surface on home; expanded on /features. Decision support, not legal advice. */
export const INTERNATIONAL_HIGHLIGHTS: {
  icon: LucideIcon
  title: string
  body: string
}[] = [
  {
    icon: BarChart3,
    title: "H-1B and petition context",
    body: "Statistical context from public filings and patterns—so you know where to look closer. Not a guarantee for any case or role.",
  },
  {
    icon: Building2,
    title: "Company intelligence & profiles",
    body: "Sponsorship-style scores from employer history, plus company pages with LCA-style signals and role families—framed as signals, not promises for the open role.",
  },
  {
    icon: CalendarClock,
    title: "OPT & STEM organization",
    body: "A timeline dashboard to plan your search and weekly cadence. Built as planning support—confirm dates with your DSO.",
  },
  {
    icon: Scale,
    title: "Salary & LCA context",
    body: "Where we have data, see how a posted range compares to similar filings—an estimate, not a determination of what you should be paid.",
  },
  {
    icon: Activity,
    title: "Triage signals on each job",
    body: "Visa fit, posting language, stale-post and ghost-style risk cues, and a clear next-step style verdict—so you don't drown in tabs.",
  },
  {
    icon: Shield,
    title: "Offer & risk checklist",
    body: "Offer Risk Analyzer: questions to ask HR and a calm readout of mixed signals. Organization support, not legal advice.",
  },
]

export const FEATURES_HERO = {
  kicker: "What you get",
  title: "The hiring stack, without the tab overload",
  subtitle:
    "Fresh jobs, match scores, autofill, and—when you need it—visa and offer context in one product. Below is the full list in two scrollable bands, not a wall of cards.",
} as const

export const LANDING_INTL_CTA = {
  title: "Know where to focus before you spend the application",
  body: "Sponsorship history, H-1B context from public data, role-level signals, and tools for OPT timing—on the job feed and job pages. Use it to prioritize, then verify with the employer or counsel.",
} as const
