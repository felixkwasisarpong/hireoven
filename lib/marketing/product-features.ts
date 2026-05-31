import type { LucideIcon } from "lucide-react"
import {
  Activity,
  BarChart3,
  BookOpen,
  Bookmark,
  BrainCircuit,
  Building2,
  CalendarClock,
  BarChart4,
  Code2,
  FileCheck2,
  Flame,
  Ghost,
  Kanban,
  Layers,
  MessageSquare,
  Scale,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Video,
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
    body: "New roles land in your feed within minutes of going live. The first handful of applicants get the most eyes. We make sure you're in it.",
    accent: "text-[#0369A1]",
    ring: "border-[#BAE6FD] bg-[#F0F9FF]",
  },
  {
    icon: Target,
    title: "AI match scores on every role",
    body: "Only see roles that actually fit your resume, seniority, and location. Low-fit postings are filtered out before you ever scroll past them.",
    accent: "text-orange-700",
    ring: "border-orange-200 bg-orange-50",
  },
  {
    icon: Wand2,
    title: "One-click apply, done",
    body: "Greenhouse, Lever, Ashby, Workday. Our autofill handles the tedious fields so you ship applications in seconds, not minutes.",
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
    body: "Follow companies you love. The moment they post, you hear about it: email, push, or right inside your dashboard.",
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
    body: "Statistical context from public filings and patterns, so you know where to look closer. Not a guarantee for any case or role.",
  },
  {
    icon: Building2,
    title: "Company intelligence & profiles",
    body: "Sponsorship-style scores from employer history, plus company pages with LCA-style signals and role families, framed as signals, not promises for the open role.",
  },
  {
    icon: CalendarClock,
    title: "OPT & STEM organization",
    body: "A timeline dashboard to plan your search and weekly cadence. Built as planning support. Confirm dates with your DSO.",
  },
  {
    icon: Scale,
    title: "Salary & LCA context",
    body: "Where we have data, see how a posted range compares to similar filings. An estimate, not a determination of what you should be paid.",
  },
  {
    icon: Activity,
    title: "Triage signals on each job",
    body: "Visa fit, posting language, stale-post and ghost-style risk cues, and a clear next-step style verdict. No more drowning in tabs.",
  },
  {
    icon: Shield,
    title: "Offer & risk checklist",
    body: "Offer Risk Analyzer: questions to ask HR and a calm readout of mixed signals. Organization support, not legal advice.",
  },
]

/** Per-job intelligence signals — on every job card and detail page */
export const JOB_INTEL_FEATURES: {
  icon: LucideIcon
  title: string
  body: string
  accent: string
  ring: string
}[] = [
  {
    icon: Ghost,
    title: "Ghost job detector",
    body: "Every listing is scored for stale-posting risk. Low / Medium / High tells you whether a role is likely still open before you spend an hour on the application.",
    accent: "text-slate-700",
    ring: "border-slate-200 bg-slate-50",
  },
  {
    icon: Shield,
    title: "Visa fit label per listing",
    body: "Each job carries a Very Strong → Blocked signal derived from posting language, company history, and LCA patterns. Know your odds at a glance.",
    accent: "text-sky-700",
    ring: "border-sky-200 bg-sky-50",
  },
  {
    icon: Scale,
    title: "LCA salary comparison",
    body: "Where we have data, see whether the posted range lands Aligned, Below Market, or Above Market versus similar LCA filings. No salary guessing.",
    accent: "text-emerald-700",
    ring: "border-emerald-200 bg-emerald-50",
  },
  {
    icon: Layers,
    title: "Match score breakdown",
    body: "Skills, Experience, Education, Location, and Role Fit, each scored separately so you know exactly which dimension is dragging your overall number down.",
    accent: "text-orange-700",
    ring: "border-orange-200 bg-orange-50",
  },
  {
    icon: Building2,
    title: "Company hiring health",
    body: "Live headcount signal from company job activity: growing, holding steady, or pulling back. Filter for companies actively expanding their teams.",
    accent: "text-violet-700",
    ring: "border-violet-200 bg-violet-50",
  },
  {
    icon: TrendingUp,
    title: "Top applicant signal",
    body: "When your resume places you in the top tier for a role, the card flags it. Prioritise the listings where you have the best shot before the crowd catches up.",
    accent: "text-teal-700",
    ring: "border-teal-200 bg-teal-50",
  },
]

/** Apex AI — career intelligence layer */
export const APEX_FEATURES: {
  icon: LucideIcon
  title: string
  body: string
  accent: string
  ring: string
}[] = [
  {
    icon: BrainCircuit,
    title: "Apex chat: your AI career coach",
    body: "Ask Apex anything about your search: which roles fit your profile, what companies to target, how to position your experience. Conversational, context-aware, and grounded in your resume.",
    accent: "text-indigo-700",
    ring: "border-indigo-200 bg-indigo-50",
  },
  {
    icon: FileCheck2,
    title: "Deep resume analysis",
    body: "Full scoring across every resume dimension with a prioritised gap list. Know exactly which lines to rewrite before you start applying to a new tier of roles.",
    accent: "text-orange-700",
    ring: "border-orange-200 bg-orange-50",
  },
  {
    icon: Wand2,
    title: "Per-job resume tailoring",
    body: "Paste a job description, get targeted bullet rewrites and a tailored skills section. Your resume says what the ATS and hiring manager need to see for that exact role.",
    accent: "text-emerald-700",
    ring: "border-emerald-200 bg-emerald-50",
  },
  {
    icon: BarChart4,
    title: "Strategy plans + cohort insights",
    body: "Apex maps your profile against an anonymised cohort of candidates in the same search. See where you rank, where the gaps are, and where to focus next.",
    accent: "text-violet-700",
    ring: "border-violet-200 bg-violet-50",
  },
  {
    icon: Users,
    title: "Bulk job analysis",
    body: "Drop in a list of jobs and Apex ranks them by fit, flags the ones with the best visa signal, and tells you which to prioritise, without opening 30 tabs.",
    accent: "text-sky-700",
    ring: "border-sky-200 bg-sky-50",
  },
  {
    icon: Sparkles,
    title: "Cover letter + sponsorship context",
    body: "Generate cover letters that include the right visa framing automatically when the company has a strong sponsorship track record. Relevant by default, editable before you send.",
    accent: "text-fuchsia-700",
    ring: "border-fuchsia-200 bg-fuchsia-50",
  },
]

/** Interview prep — text, coding, and live sessions */
export const INTERVIEW_FEATURES: {
  icon: LucideIcon
  title: string
  body: string
  accent: string
  ring: string
}[] = [
  {
    icon: MessageSquare,
    title: "Text interview: async AI interviewer",
    body: "An AI interviewer that asks probing follow-ups, adapts to your role and persona, and never lets a weak answer slide. Build your stories without time pressure, then tighten them.",
    accent: "text-orange-700",
    ring: "border-orange-200 bg-orange-50",
  },
  {
    icon: Code2,
    title: "Coding test: sandboxed in-browser",
    body: "Python or JavaScript, hidden tests, a live interviewer that watches and intervenes only when you need it. No setup, no external tools. Just a judge and a clock.",
    accent: "text-slate-700",
    ring: "border-slate-200 bg-slate-50",
  },
  {
    icon: Video,
    title: "Live voice + webcam interview",
    body: "A real-time AI interviewer with audio and optional webcam. Latency, pacing, and eye contact all in play. The closest thing to final-round prep without scheduling a human.",
    accent: "text-rose-700",
    ring: "border-rose-200 bg-rose-50",
  },
  {
    icon: BookOpen,
    title: "AI debrief with scoring",
    body: "After every session: an overall score, per-dimension breakdown, specific moments where you lost points, and concrete things to fix before the next round.",
    accent: "text-teal-700",
    ring: "border-teal-200 bg-teal-50",
  },
  {
    icon: Activity,
    title: "Voice & pacing metrics (live sessions)",
    body: "Filler word count, WPM, silence ratio, average response latency, all quantified and compared against interview norms so you know exactly what sounds unprepared.",
    accent: "text-amber-700",
    ring: "border-amber-200 bg-amber-50",
  },
  {
    icon: Flame,
    title: "Skill coverage tracking",
    body: "After each session, Apex tracks which skills the interviewer covered. Over multiple practice rounds you see which competencies you've drilled and which still need reps.",
    accent: "text-indigo-700",
    ring: "border-indigo-200 bg-indigo-50",
  },
]

/** Application tracking */
export const TRACKER_FEATURES: {
  icon: LucideIcon
  title: string
  body: string
  accent: string
  ring: string
}[] = [
  {
    icon: Kanban,
    title: "Kanban pipeline tracker",
    body: "Saved, Applied, Interview, Offer. Drag cards across stages, add notes, attach the resume version you used, and never forget where you are with any company.",
    accent: "text-sky-700",
    ring: "border-sky-200 bg-sky-50",
  },
  {
    icon: Bookmark,
    title: "One-click save from any listing",
    body: "Hit save on a job and it drops straight into your pipeline. The match score, company logo, salary range, and apply URL come along. No copy-paste.",
    accent: "text-rose-700",
    ring: "border-rose-200 bg-rose-50",
  },
  {
    icon: Zap,
    title: "AI interview prep from the tracker",
    body: "Open any saved job and launch a tailored interview practice session. The interviewer already knows the role, company, and your resume. One click from pipeline to practice.",
    accent: "text-orange-700",
    ring: "border-orange-200 bg-orange-50",
  },
]

export const FEATURES_HERO = {
  kicker: "What you get",
  title: "The hiring stack, without the tab overload",
  subtitle:
    "Fresh jobs, match scores, autofill, and visa and offer context when you need it, all in one product. The full list below.",
} as const

export const LANDING_INTL_CTA = {
  title: "Know where to focus before you spend the application",
  body: "Sponsorship history, H-1B context from public data, role-level signals, and tools for OPT timing. All on the job feed and job pages. Use it to prioritize, then verify with the employer or counsel.",
} as const
