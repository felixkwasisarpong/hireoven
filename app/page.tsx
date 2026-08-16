import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { PLAN_DATA } from "@/lib/pricing"
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Bookmark,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Chrome,
  Clock3,
  FileCheck2,
  FileSearch,
  Ghost,
  MapPin,
  Mic2,
  MousePointerClick,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react"
import MaintenanceBanner from "@/components/marketing/MaintenanceBanner"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import HireovenLogo from "@/components/ui/HireovenLogo"
import StayDemo from "@/components/stay/StayDemo"
import { getCapExemptStats } from "@/lib/stay/queries"
import { getFeaturedSocRoles } from "@/lib/salaries/soc-roles"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export const revalidate = 300

export const metadata: Metadata = {
  title: "Hireoven - Fresh jobs with sponsor proof.",
  description:
    "Search fresh jobs from employer career pages with H-1B sponsorship evidence, profile match scoring, alerts, and one-click application autofill.",
}

/** Shared page shell: max width and horizontal padding for every section. */
const SHELL = "mx-auto w-full max-w-[80rem] px-5 lg:px-8"
/** Standard white surface. Radius and shadow come from the theme primitives. */
const CARD = "term-panel"

type LogoCompany = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  careers_url?: string | null
  ats_type?: string | null
  job_count?: number | null
  h1b_sponsor_count_1yr?: number | null
  h1b_sponsor_count_3yr?: number | null
  sponsors_h1b?: boolean | null
  sponsorship_confidence?: number | null
  last_crawled_at?: Date | string | null
}

const fallbackCompanies: LogoCompany[] = [
  { id: "palantir", name: "Palantir", domain: "palantir.com", logo_url: "/company-logos/palantir.svg" },
  { id: "anthropic", name: "Anthropic", domain: "anthropic.com", logo_url: "/company-logos/anthropic.svg" },
  { id: "google", name: "Google", domain: "google.com", logo_url: "/company-logos/google.svg" },
  { id: "doordash", name: "DoorDash", domain: "doordash.com", logo_url: "/company-logos/doordash.svg" },
  { id: "capital-one", name: "Capital One", domain: "capitalone.com", logo_url: "/company-logos/capital-one.svg" },
  { id: "palo-alto", name: "Palo Alto Networks", domain: "paloaltonetworks.com", logo_url: "/company-logos/palo-alto-networks.svg" },
  { id: "samsara", name: "Samsara", domain: "samsara.com", logo_url: "/company-logos/samsara.svg" },
  { id: "cockroach-labs", name: "Cockroach Labs", domain: "cockroachlabs.com", logo_url: "/company-logos/cockroach-labs.svg" },
  { id: "toast", name: "Toast", domain: "toasttab.com", logo_url: "/company-logos/toast.svg" },
  { id: "expedia", name: "Expedia Group", domain: "expediagroup.com", logo_url: "/company-logos/expedia-group.svg" },
  { id: "state-street", name: "State Street", domain: "statestreet.com", logo_url: "/company-logos/state-street.svg" },
  { id: "autodesk", name: "Autodesk", domain: "autodesk.com", logo_url: "/company-logos/autodesk.svg" },
  { id: "intel", name: "Intel", domain: "intel.com", logo_url: "/company-logos/intel.svg" },
  { id: "qualcomm", name: "Qualcomm", domain: "qualcomm.com", logo_url: "/company-logos/qualcomm.svg" },
  { id: "allstate", name: "Allstate", domain: "allstate.com", logo_url: "/company-logos/allstate.svg" },
  { id: "fidelity", name: "Fidelity", domain: "fidelity.com", logo_url: "/company-logos/fidelity.png" },
  { id: "home-depot", name: "Home Depot", domain: "homedepot.com", logo_url: "/company-logos/homedepot.svg" },
  { id: "boeing", name: "Boeing", domain: "boeing.com", logo_url: "/company-logos/boeing.svg" },
]

const curatedCompanyDomains = fallbackCompanies
  .map((company) => company.domain?.trim().toLowerCase())
  .filter((domain): domain is string => Boolean(domain))

const howItWorksSteps = [
  {
    icon: BellRing,
    image: "/marketing/job-alert-workspace.webp",
    title: "Get alerted while the role is still fresh",
    body: "We monitor company career pages directly instead of waiting for aggregators to catch up, so new openings reach you within minutes of going live.",
  },
  {
    icon: ShieldCheck,
    image: "/marketing/evidence-dashboard.webp",
    title: "See the sponsorship evidence up front",
    body: "Every listing carries H-1B petition history from public DOL and USCIS records, plus visa language found in the posting itself.",
  },
  {
    icon: MousePointerClick,
    image: "/marketing/autofill-workflow.webp",
    title: "Apply without retyping your life story",
    body: "The Chrome extension fills repetitive fields across Greenhouse, Lever, Ashby, Workday, iCIMS and more, then waits for your review before anything is submitted.",
  },
]

const carouselSlides = [
  {
    image: "/marketing/carousel-alerts-dark.webp",
    kicker: "Fresh alerts",
    title: "See new roles while they are still warm",
    body: "Career-page monitoring brings roles into your feed before aggregator traffic piles on.",
  },
  {
    image: "/marketing/carousel-sponsor-dark.webp",
    kicker: "Sponsor proof",
    title: "Prioritize employers with real filing history",
    body: "Petition and wage evidence stays attached to the company and role context.",
  },
  {
    image: "/marketing/carousel-autofill-dark.webp",
    kicker: "Apply faster",
    title: "Review the application before anything goes out",
    body: "Autofill and Apex prep the repetitive parts while final approval stays with you.",
  },
]

const featureCards = [
  {
    icon: Bot,
    category: "Apex AI",
    title: "An application assistant that does the legwork",
    body: "Apex researches companies, builds an application queue, tailors your materials, and drives the browser flow. Sensitive steps pause for approval and final submission always stays with you.",
    tags: ["Apply agent", "Browser operator", "Career profile"],
    href: "/signup?next=%2Fdashboard%2Fapex",
  },
  {
    icon: Chrome,
    category: "Chrome extension",
    title: "One-click apply across messy ATS forms",
    body: "Autofill packets, field review, and live match context follow you across Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, BambooHR and more.",
    tags: ["Autofill", "Wide ATS support", "LinkedIn import"],
    href: "/extension",
  },
  {
    icon: Mic2,
    category: "Interview prep",
    title: "Voice and coding practice tied to the role",
    body: "Practice with role-specific prompts, live voice sessions, coding interviews, and AI debriefs that turn a rough answer into a better one next time.",
    tags: ["Voice", "Coding", "Debrief"],
    href: "/signup?next=%2Fdashboard%2Finterview",
  },
  {
    icon: Ghost,
    category: "Ghost-job detection",
    title: "Skip postings that will not go anywhere",
    body: "Timing, reposting patterns, freshness, and employer signals flag listings that look stale, recycled, or built to collect resumes before you spend an application on them.",
    tags: ["Repost signals", "Timing", "Risk score"],
    href: "/find",
  },
  {
    icon: Users,
    category: "Peer signals",
    title: "See the market through people like you",
    body: "Layoff cohorts, peer movement, and background-matched signals show where candidates with your profile are actually getting traction right now.",
    tags: ["Cohorts", "Layoff radar", "Peer moves"],
    href: "/signup?next=%2Fdashboard%2Fcohorts",
  },
  {
    icon: FileSearch,
    category: "Salary and offers",
    title: "Know the number before the conversation",
    body: "H-1B wage data, salary comparisons, offer tracking, and shareable sponsorability scorecards keep the compensation picture attached to every role.",
    tags: ["Wage data", "Scorecard", "Offer tracking"],
    href: "/h1b-salaries",
  },
]

/** Illustrative job cards for the hero preview. Labelled as an example in the UI. */
const previewJobs = [
  {
    company: "Anthropic",
    domain: "anthropic.com",
    logo: "/company-logos/anthropic.svg",
    title: "Staff ML Platform Engineer",
    location: "San Francisco, CA · Hybrid",
    posted: "7 minutes ago",
    match: 91,
    sponsor: "Sponsors H-1B",
    source: "Greenhouse",
    fresh: true,
  },
  {
    company: "Samsara",
    domain: "samsara.com",
    logo: "/company-logos/samsara.svg",
    title: "Senior Backend Engineer, Data",
    location: "Remote · United States",
    posted: "24 minutes ago",
    match: 84,
    sponsor: "Sponsors H-1B",
    source: "Lever",
    fresh: true,
  },
  {
    company: "Autodesk",
    domain: "autodesk.com",
    logo: "/company-logos/autodesk.svg",
    title: "Product Analyst II",
    location: "Boston, MA · On-site",
    posted: "1 hour ago",
    match: 78,
    sponsor: "Sponsor history",
    source: "Workday",
    fresh: false,
  },
]

const sponsorshipProofPoints = [
  {
    title: "Petition history, not guesswork",
    body: "Approved and denied H-1B petitions from public USCIS records, counted per employer over the last one and three years.",
  },
  {
    title: "Prevailing wage from DOL filings",
    body: "Certified LCA wage levels by role and worksite, so you can compare an offer against what the employer has actually filed.",
  },
  {
    title: "Cap-exempt employers surfaced",
    body: "Universities, non-profits, and affiliated research employers that hire outside the annual lottery entirely.",
  },
]

async function getPlatformStats() {
  if (!hasPostgresEnv()) return { jobs: 0, companies: 0 }
  try {
    const pool = getPostgresPool()
    const [jobs, companies] = await Promise.all([
      pool.query<{ c: string }>(
        `SELECT COALESCE((
           SELECT GREATEST(0, reltuples)::bigint::text
           FROM pg_class
           WHERE oid = to_regclass('public.idx_jobs_us_ca_active_freshest')
         ), '0') AS c`
      ),
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM companies WHERE is_active = true`),
    ])
    return { jobs: Number(jobs.rows[0]?.c ?? 0), companies: Number(companies.rows[0]?.c ?? 0) }
  } catch {
    return { jobs: 0, companies: 0 }
  }
}

async function getFeaturedCompanies(): Promise<LogoCompany[]> {
  if (!hasPostgresEnv()) return []
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<LogoCompany>(
      `SELECT id, name, domain, logo_url, careers_url, ats_type, job_count,
              h1b_sponsor_count_1yr, h1b_sponsor_count_3yr, sponsors_h1b,
              sponsorship_confidence, last_crawled_at
       FROM companies
       WHERE is_active = true AND job_count > 0 AND domain IS NOT NULL
         AND domain ~* '^[a-z0-9.-]+[.][a-z]{2,}$'
         AND domain !~* '(builtin-discovery|placeholder|uscis-employer|lca-employer|myworkdayjobs|workday-tenant|greenhouse-discovered|greenhouse-tenant|smartrecruiters-discovered|smartrecruiters-tenant|bamboohr|workable-discovered|teamtailor|breezy|lever-discovered|ashby-discovered|icims-discovered|rippling-discovered)'
       ORDER BY
         CASE WHEN lower(domain) = ANY($1::text[]) THEN 0 ELSE 1 END ASC,
         array_position($1::text[], lower(domain)) ASC NULLS LAST,
         CASE
           WHEN logo_url ILIKE '/company-logos/%' THEN 0
           WHEN logo_url ILIKE 'https://img.logo.dev/%' THEN 0
           WHEN logo_url IS NULL OR logo_url = '' THEN 1
           WHEN logo_url ILIKE '%google.com/s2/favicons%' THEN 2
           WHEN logo_url ILIKE '%gstatic.com/faviconV2%' THEN 2
           ELSE 1
         END ASC,
         job_count DESC
       LIMIT 36`,
      [curatedCompanyDomains]
    )
    return rows
  } catch {
    return []
  }
}

function formatCount(value: number, fallback: string) {
  return value > 0 ? value.toLocaleString() : fallback
}

function formatCompactCount(value: number, fallback: string) {
  if (value <= 0) return fallback

  return new Intl.NumberFormat("en", {
    compactDisplay: "short",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
    notation: "compact",
  }).format(value)
}

function uniqueLogoCompanies(companies: LogoCompany[]) {
  const seenDomains = new Set<string>()
  const seenNames = new Set<string>()
  return companies.filter((company) => {
    const domainKey = company.domain?.trim().toLowerCase() ?? ""
    const nameKey = company.name.trim().toLowerCase()
    if (!nameKey || seenNames.has(nameKey) || (domainKey && seenDomains.has(domainKey))) return false
    if (domainKey) seenDomains.add(domainKey)
    seenNames.add(nameKey)
    return true
  })
}

function isLocalCompanyLogo(logoUrl: string | null) {
  return Boolean(logoUrl?.startsWith("/company-logos/"))
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function companyHref(company: LogoCompany) {
  return isUuid(company.id) ? `/companies/${company.id}` : "/companies"
}

function numberValue(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function cleanDomain(domain: string | null | undefined) {
  return domain?.replace(/^www\./i, "") ?? "Company page"
}

function formatAtsType(value: string | null | undefined) {
  if (!value) return null
  const labels: Record<string, string> = {
    ashby: "Ashby",
    bamboohr: "BambooHR",
    custom: "Official",
    eightfold: "Eightfold",
    greenhouse: "Greenhouse",
    icims: "iCIMS",
    jobvite: "Jobvite",
    lever: "Lever",
    smartrecruiters: "SmartRecruiters",
    workday: "Workday",
  }
  return labels[value.toLowerCase()] ?? value
}

function formatCrawlDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date)
}

function companyProof(company: LogoCompany) {
  const jobCount = numberValue(company.job_count)
  const h1bRecent = numberValue(company.h1b_sponsor_count_1yr)
  const h1bThreeYear = numberValue(company.h1b_sponsor_count_3yr)
  const confidence = numberValue(company.sponsorship_confidence)
  const ats = formatAtsType(company.ats_type)
  const lastCrawled = formatCrawlDate(company.last_crawled_at)

  const sponsorValue =
    h1bRecent > 0
      ? `${formatCount(h1bRecent, "0")} recent`
      : h1bThreeYear > 0
        ? `${formatCount(h1bThreeYear, "0")} historical`
        : company.sponsors_h1b || confidence >= 60
          ? `${Math.max(confidence, 60)}% signal`
          : "Not confirmed"

  return {
    primary: jobCount > 0 ? formatCount(jobCount, "0") : "Tracked",
    primaryLabel: jobCount > 0 ? "Open roles tracked" : "Verified source",
    source: ats ? `${ats} careers source` : cleanDomain(company.domain),
    sponsorValue,
    sponsorLabel: h1bRecent > 0 || h1bThreeYear > 0 ? "H-1B petitions" : "Sponsor signal",
    footer: lastCrawled ? `Crawled ${lastCrawled}` : "Public company source",
  }
}

function SectionHeading({
  align = "left",
  eyebrow,
  title,
  body,
}: {
  align?: "left" | "center"
  eyebrow: string
  title: React.ReactNode
  body?: string
}) {
  const centered = align === "center"
  return (
    <div className={centered ? "mx-auto max-w-[44rem] text-center" : "max-w-[42rem]"}>
      <p className="term-label">{eyebrow}</p>
      <h2 className="mt-3 text-[1.9rem] font-semibold leading-[1.15] tracking-tight text-[var(--term-strong)] md:text-[2.5rem]">
        {title}
      </h2>
      {body ? (
        <p className={`mt-4 text-[16px] leading-relaxed text-[var(--term-fg)] ${centered ? "" : "max-w-[38rem]"}`}>
          {body}
        </p>
      ) : null}
    </div>
  )
}

function EmailCapture({ next = "/dashboard/onboarding" }: { next?: string }) {
  return (
    <form action="/signup" className="flex w-full max-w-[32rem] flex-col gap-2.5 sm:flex-row" method="get">
      <input name="next" type="hidden" value={next} />
      <input
        aria-label="Email"
        className="min-h-[3rem] min-w-0 flex-1 rounded-md border border-[var(--term-line-strong)] bg-[var(--term-input-bg)] px-4 text-[15px] text-[var(--term-fg)] outline-none"
        name="email"
        placeholder="Enter your email"
        type="email"
      />
      <button className="term-btn term-btn-amber min-h-[3rem] shrink-0 justify-center" type="submit">
        Get started free
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </form>
  )
}

function HeroSearchForm() {
  return (
    <form action="/find" className={`${CARD} mt-8 grid gap-2 p-2 sm:grid-cols-[1fr_auto]`} method="get">
      <label className="sr-only" htmlFor="home-role-search">
        Search jobs
      </label>
      <div className="flex min-h-[3.35rem] min-w-0 items-center gap-3 rounded-md bg-[var(--term-panel-2)] px-4">
        <Search className="h-4 w-4 shrink-0 text-[var(--term-dim)]" aria-hidden />
        <input
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[var(--term-strong)] outline-none placeholder:text-[var(--term-dim)]"
          id="home-role-search"
          name="role"
          placeholder="Software engineer, data analyst, product manager..."
          required
          type="search"
        />
      </div>
      <button className="term-btn term-btn-amber min-h-[3.35rem] justify-center px-5" type="submit">
        Find jobs
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </form>
  )
}

function AnnouncementBar() {
  return (
    <Link
      className="marketing-announcement-link"
      href="/extension"
      prefetch
    >
      <Chrome className="h-4 w-4 shrink-0 text-[var(--term-amber-on-ink)]" aria-hidden />
      The Hireoven extension is live on Chrome
      <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </Link>
  )
}

/** Illustrative feed preview. Mirrors the real job-card layout in the product. */
function JobFeedPreview() {
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--term-line)] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-[var(--term-dim)]" aria-hidden />
          <span className="text-[14px] font-semibold text-[var(--term-strong)]">Your job feed</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--term-green-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--term-green)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--term-green)]" aria-hidden />
          Live
        </span>
      </div>

      <ul className="divide-y divide-[var(--term-line)]">
        {previewJobs.map((job) => (
          <li className="px-5 py-4 transition hover:bg-[var(--term-panel-2)]" key={job.title}>
            <div className="flex items-start gap-3">
              <Image
                alt=""
                className="h-11 w-11 shrink-0 rounded-md border border-[var(--term-line-strong)] bg-white object-contain p-1.5"
                height={44}
                src={job.logo}
                width={44}
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-[var(--term-strong)]">{job.title}</p>
                <p className="mt-0.5 truncate text-[13.5px] text-[var(--term-strong)]">{job.company}</p>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-[var(--term-dim)]">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {job.location}
                </p>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--term-green-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--term-green)]">
                    <BadgeCheck className="h-3 w-3" aria-hidden />
                    {job.sponsor}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-[var(--term-line-strong)] px-2 py-0.5 text-[11px] font-medium text-[var(--term-fg)]">
                    {job.match}% match
                  </span>
                  <span className="hidden items-center rounded-full border border-[var(--term-line-strong)] px-2 py-0.5 text-[11px] font-medium text-[var(--term-fg)] sm:inline-flex">
                    {job.source}
                  </span>
                </div>

                <p
                  className={`mt-2.5 flex items-center gap-1.5 text-[12px] font-medium ${
                    job.fresh ? "text-[var(--term-green)]" : "text-[var(--term-dim)]"
                  }`}
                >
                  <Clock3 className="h-3.5 w-3.5" aria-hidden />
                  Posted {job.posted}
                </p>
              </div>

              <Bookmark className="mt-1 h-4 w-4 shrink-0 text-[var(--term-dim)]" aria-hidden />
            </div>
          </li>
        ))}
      </ul>

      <p className="border-t border-[var(--term-line)] bg-[var(--term-panel-2)] px-5 py-3 text-[11.5px] text-[var(--term-dim)]">
        Example feed. Live results depend on your profile, filters, and current openings.
      </p>
    </div>
  )
}

function HeroSection({ stats }: { stats: { jobs: number; companies: number } }) {
  return (
    <section className={`${SHELL} pb-14 pt-12 sm:pt-16`}>
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--term-line-strong)] bg-[var(--term-panel)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--term-fg)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--term-amber)]" aria-hidden />
            {formatCount(stats.jobs, "10,000+")} live jobs tracked right now
          </p>

          <h1 className="mt-6 max-w-[38rem] text-[2.55rem] font-semibold leading-[1.08] tracking-tight text-[var(--term-strong)] sm:text-[3.35rem]">
            Search fresh jobs with sponsor proof before you apply.
          </h1>

          <p className="mt-5 max-w-[36rem] text-[17px] leading-relaxed text-[var(--term-fg)]">
            Hireoven monitors employer career pages directly, scores each role against your profile, and attaches H-1B
            evidence before you spend time on the application.
          </p>

          <HeroSearchForm />

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            {["Free to search", "No credit card required", "H-1B evidence built in"].map((label) => (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--term-dim)]" key={label}>
                <CheckCircle2 className="h-4 w-4 text-[var(--term-green)]" aria-hidden />
                {label}
              </span>
            ))}
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="term-btn term-btn-amber" href="/signup?next=%2Fdashboard%2Fonboarding">
              Create free alerts
              <BellRing className="h-4 w-4" aria-hidden />
            </Link>
            <Link className="term-btn" href="/companies">
              Browse companies
            </Link>
          </div>
        </div>

        <JobFeedPreview />
      </div>
    </section>
  )
}

function ImageCarouselSection() {
  return (
    <section className="bg-[var(--term-ink)] py-16">
      <div className="mx-auto w-full max-w-[80rem] px-5 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--term-amber-on-ink)]">Product workflow</p>
            <h2 className="mt-3 max-w-[28rem] text-[1.8rem] font-semibold leading-[1.12] tracking-tight text-[var(--term-on-ink)] md:text-[2.35rem]">
              A job search cockpit, not another list of stale posts
            </h2>
            <p className="mt-4 max-w-[31rem] text-[15px] leading-7 text-[var(--term-on-ink-dim)]">
              The carousel shows the three surfaces that matter most: freshness, proof, and application speed.
            </p>
          </div>

          <div className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:px-0">
            {carouselSlides.map(({ body, image, kicker, title }) => (
              <article
                className="min-w-[82%] snap-start overflow-hidden rounded-lg border border-white/12 bg-[var(--term-ink-2)] shadow-[0_18px_44px_-26px_rgba(16,24,40,0.55)] sm:min-w-[25rem] lg:min-w-[31rem]"
                key={title}
              >
                <div className="relative aspect-[3/2] border-b border-white/10">
                  <Image alt="" className="object-cover" fill sizes="(min-width: 1024px) 32rem, 82vw" src={image} />
                </div>
                <div className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--term-amber-on-ink)]">{kicker}</p>
                  <h3 className="mt-2 text-[1.05rem] font-semibold leading-snug text-[var(--term-on-ink)]">{title}</h3>
                  <p className="mt-2 text-[13.5px] leading-6 text-[var(--term-on-ink-dim)]">{body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function StatBar({ stats }: { stats: { jobs: number; companies: number } }) {
  const items = [
    { value: formatCompactCount(stats.jobs, "10k+"), label: "Live openings tracked" },
    { value: formatCompactCount(stats.companies, "1k+"), label: "Companies monitored" },
    { value: "15+", label: "ATS platforms supported" },
    { value: "Minutes", label: "From posting to alert" },
  ]

  return (
    <section className={SHELL}>
      <dl className={`${CARD} grid grid-cols-2 gap-px overflow-hidden bg-[var(--term-line)] md:grid-cols-4`}>
        {items.map(({ label, value }) => (
          <div className="bg-[var(--term-panel)] px-5 py-6 text-center" key={label}>
            <dt className="sr-only">{label}</dt>
            <dd>
              <span className="block text-[1.9rem] font-semibold leading-none tabular-nums text-[var(--term-strong)]">
                {value}
              </span>
              <span className="mt-2 block text-[12.5px] text-[var(--term-dim)]">{label}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function CompanyTile({ company, priority }: { company: LogoCompany; priority: boolean }) {
  const proof = companyProof(company)

  return (
    <Link
      aria-label={`View ${company.name}`}
      className="group relative z-0 flex min-h-[88px] items-center justify-center gap-2.5 bg-[var(--term-panel)] px-4 py-4 transition hover:z-20 hover:bg-[var(--term-panel-2)] focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--term-amber)]"
      href={companyHref(company)}
      title={company.name}
    >
      {isLocalCompanyLogo(company.logo_url) ? (
        <Image
          alt={company.name}
          className="h-8 w-8 shrink-0 object-contain opacity-75 grayscale transition duration-200 group-hover:opacity-100 group-hover:grayscale-0"
          height={32}
          src={company.logo_url ?? ""}
          width={32}
        />
      ) : (
        <CompanyLogo
          className="h-8 w-8 shrink-0 rounded-md border border-[var(--term-line-strong)] bg-white opacity-85 grayscale transition duration-200 group-hover:opacity-100 group-hover:grayscale-0"
          companyName={company.name}
          domain={company.domain}
          logoUrl={company.logo_url}
          priority={priority}
        />
      )}
      <span className="max-w-[7rem] truncate text-[13px] font-medium text-[var(--term-fg)] transition group-hover:text-[var(--term-strong)]">
        {company.name}
      </span>

      {/* Hover card: real crawl and public H-1B figures for this employer. */}
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-50 hidden w-[17rem] -translate-x-1/2 translate-y-1 rounded-lg border border-[var(--term-line-strong)] bg-[var(--term-panel)] p-4 text-left opacity-0 shadow-[0_18px_42px_rgba(16,24,40,0.12)] transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:block">
        <span className="flex items-center gap-3 border-b border-[var(--term-line)] pb-3">
          {isLocalCompanyLogo(company.logo_url) ? (
            <Image alt="" className="h-8 w-8 object-contain" height={32} src={company.logo_url ?? ""} width={32} />
          ) : (
            <CompanyLogo
              className="h-8 w-8 rounded-md border border-[var(--term-line-strong)] bg-white"
              companyName={company.name}
              domain={company.domain}
              logoUrl={company.logo_url}
            />
          )}
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-[var(--term-strong)]">{company.name}</span>
            <span className="block truncate text-[11.5px] text-[var(--term-dim)]">{proof.source}</span>
          </span>
        </span>

        <span className="mt-3 grid grid-cols-2 gap-2">
          <span className="rounded-md border border-[var(--term-line-strong)] p-3">
            <span className="term-label block">{proof.primaryLabel}</span>
            <span className="mt-1 block text-[18px] font-semibold tabular-nums text-[var(--term-strong)]">
              {proof.primary}
            </span>
          </span>
          <span className="rounded-md border border-[var(--term-line-strong)] p-3">
            <span className="term-label block">{proof.sponsorLabel}</span>
            <span className="mt-1 block text-[14px] font-semibold tabular-nums text-[var(--term-green)]">
              {proof.sponsorValue}
            </span>
          </span>
        </span>

        <span className="mt-3 flex items-center justify-between gap-3 text-[11.5px] text-[var(--term-dim)]">
          <span>{proof.footer}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-[var(--term-amber-text)]">
            View
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </span>
      </span>
    </Link>
  )
}

function TrustedBySection({
  companies,
  stats,
}: {
  companies: LogoCompany[]
  stats: { jobs: number; companies: number }
}) {
  const sourceCompanies = companies.length > 0 ? companies : fallbackCompanies
  const visibleCompanies = uniqueLogoCompanies(sourceCompanies).slice(0, 21)

  return (
    <section className={`${SHELL} py-16`}>
      <p className="text-center text-[13px] font-medium text-[var(--term-dim)]">
        Openings tracked directly from employers including
      </p>

      <div className={`${CARD} relative z-0 mt-6 grid grid-cols-2 gap-px bg-[var(--term-line)] sm:grid-cols-3 lg:grid-cols-7`}>
        {visibleCompanies.map((company, index) => (
          <CompanyTile company={company} key={company.id} priority={index < 7} />
        ))}
      </div>

      <p className="mx-auto mt-5 max-w-[52rem] text-center text-[13px] leading-6 text-[var(--term-dim)]">
        Tracking {formatCount(stats.companies, "1,000+")} companies across Greenhouse, Lever, Ashby, Workday, iCIMS,
        SmartRecruiters, Jobvite, SuccessFactors and more. Hover figures come from Hireoven&apos;s current crawl plus
        public H-1B employer records; sponsorship for any specific role is still up to the employer.
      </p>
    </section>
  )
}

function HowItWorksSection() {
  return (
    <section className={`${SHELL} py-16`}>
      <SectionHeading
        align="center"
        eyebrow="How it works"
        title="Three things that decide whether you get the interview"
        body="Most applications are lost on timing, on wasted effort, or on a form that takes forty minutes. Hireoven works on all three."
      />

      <ol className="mt-12 grid gap-5 md:grid-cols-3">
        {howItWorksSteps.map(({ body, icon: Icon, image, title }, index) => (
          <li className={`${CARD} flex flex-col overflow-hidden`} key={title}>
            <div className="relative aspect-[3/2] w-full border-b border-[var(--term-line)] bg-[var(--term-panel-2)]">
              <Image
                alt=""
                className="object-cover"
                fill
                sizes="(min-width: 768px) 33vw, 100vw"
                src={image}
              />
            </div>

            <div className="flex flex-1 flex-col p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--term-amber-soft)] text-[var(--term-amber)]">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="term-label">Step {index + 1}</span>
              </div>
              <h3 className="mt-5 text-[1.15rem] font-semibold leading-snug tracking-tight text-[var(--term-strong)]">
                {title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-6 text-[var(--term-fg)]">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function SponsorshipSection() {
  return (
    <section className={`${SHELL} py-16`}>
      <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div>
          <SectionHeading
            eyebrow="Sponsorship intelligence"
            title="Stop guessing whether an employer sponsors"
            body="Hireoven attaches public immigration and wage records to the companies you are applying to, so you can prioritize before you spend an hour on an application form."
          />

          <div className={`${CARD} relative mt-8 hidden aspect-[3/2] w-full overflow-hidden lg:block`}>
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="(min-width: 1024px) 45vw, 100vw"
              src="/marketing/sponsorship-research.webp"
            />
          </div>
        </div>

        <div className="grid gap-4">
          {sponsorshipProofPoints.map(({ body, title }) => (
            <div className={`${CARD} flex gap-4 p-5`} key={title}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--term-green-soft)] text-[var(--term-green)]">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--term-strong)]">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-6 text-[var(--term-fg)]">{body}</p>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-3">
            <Link className="term-btn term-btn-amber" href="/h1b-sponsors">
              Browse H-1B sponsors
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link className="term-btn" href="/h1b-salaries">
              See H-1B salary data
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function StaySection({
  capExemptRoles,
  roleOptions,
}: {
  capExemptRoles: number
  roleOptions: { socGroup: string; label: string }[]
}) {
  return (
    <section className={`${SHELL} py-16`}>
      <SectionHeading
        align="center"
        eyebrow="Stay"
        title="Will this job actually keep you in the country?"
        body="The 2026 rules changed the H-1B maths. Stay scores each role by your real odds of building a lasting career here, and surfaces the employers that skip the lottery entirely."
      />

      <div className="mx-auto mt-10 max-w-[74rem]">
        <StayDemo capExemptRoles={capExemptRoles} roleOptions={roleOptions} />
      </div>

      <div className="mt-8 flex justify-center">
        <Link className="term-btn term-btn-amber" href="/stay">
          Open the full Stay toolkit
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  )
}

function FeatureCard({ body, category, href, icon: Icon, tags, title }: (typeof featureCards)[number]) {
  return (
    <Link className={`${CARD} term-panel-hover group flex flex-col p-6`} href={href}>
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--term-amber-soft)] text-[var(--term-amber)]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <ArrowRight
          className="h-4 w-4 text-[var(--term-dim)] transition group-hover:translate-x-1 group-hover:text-[var(--term-amber)]"
          aria-hidden
        />
      </div>

      <p className="term-label mt-5">{category}</p>
      <h3 className="mt-2 text-[1.1rem] font-semibold leading-snug tracking-tight text-[var(--term-strong)]">
        {title}
      </h3>
      <p className="mt-3 flex-1 text-[14px] leading-6 text-[var(--term-fg)]">{body}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            className="rounded-full border border-[var(--term-line-strong)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--term-dim)]"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </div>
    </Link>
  )
}

function FeaturesSection() {
  return (
    <section className={`${SHELL} py-16`}>
      <SectionHeading
        align="center"
        eyebrow="The platform"
        title="Everything the search needs, in one place"
        body="The job feed is the front door. Behind it sit the application agent, autofill, interview practice, ghost-job detection, peer signals, and salary evidence."
      />

      <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {featureCards.map((card) => (
          <FeatureCard key={card.title} {...card} />
        ))}
      </div>
    </section>
  )
}

function ApexSection() {
  const capabilities = [
    { icon: Search, label: "Finds the openings worth your time" },
    { icon: FileCheck2, label: "Tailors your resume to the role" },
    { icon: MousePointerClick, label: "Fills the application form" },
    { icon: BellRing, label: "Keeps the search moving" },
  ]

  return (
    <section className={`${SHELL} py-16`}>
      <div className={`${CARD} grid gap-10 p-8 lg:grid-cols-[1fr_0.85fr] lg:items-center lg:p-12`}>
        <div>
          <p className="term-label">Apex AI</p>
          <h2 className="mt-3 max-w-[32rem] text-[1.9rem] font-semibold leading-[1.15] tracking-tight text-[var(--term-strong)] md:text-[2.4rem]">
            Let the busy work leave your job search
          </h2>
          <p className="mt-4 max-w-[34rem] text-[16px] leading-relaxed text-[var(--term-fg)]">
            Apex handles the research, the tailoring, and the application prep while every decision that matters stays
            with you. Nothing is submitted without your approval.
          </p>

          <div className="mt-8">
            <EmailCapture next="/dashboard/apex" />
          </div>
          <p className="mt-4 text-[13px] text-[var(--term-dim)]">
            Free plan available. Paid plans start at ${PLAN_DATA.pro.monthly}/month.
          </p>
        </div>

        <div>
          <div className="relative aspect-[3/2] w-full overflow-hidden rounded-lg border border-[var(--term-line-strong)] bg-[var(--term-panel-2)]">
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="(min-width: 1024px) 40vw, 100vw"
              src="/marketing/apex-workflow.webp"
            />
          </div>

          <ul className="mt-4 grid gap-3">
            {capabilities.map(({ icon: Icon, label }) => (
              <li
                className="flex items-center gap-3 rounded-lg border border-[var(--term-line-strong)] bg-[var(--term-panel-2)] px-4 py-3.5"
                key={label}
              >
                <Icon className="h-4 w-4 shrink-0 text-[var(--term-amber)]" aria-hidden />
                <span className="text-[14px] font-medium text-[var(--term-strong)]">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function FinalCtaSection() {
  return (
    <section className={`${SHELL} py-16`}>
      <div className={`${CARD} mx-auto flex max-w-[46rem] flex-col items-center p-8 text-center sm:p-12`}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--term-amber-soft)] text-[var(--term-amber)]">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="mt-6 text-[1.9rem] font-semibold leading-[1.12] tracking-tight text-[var(--term-strong)] md:text-[2.5rem]">
          Stop finding out about jobs days late
        </h2>
        <p className="mt-4 max-w-[34rem] text-[16px] leading-relaxed text-[var(--term-fg)]">
          Let Hireoven watch the market, check the sponsorship evidence, and prepare the application while the role is
          still fresh.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <EmailCapture />
        </div>
      </div>
    </section>
  )
}

function FooterColumn({ links, title }: { links: { href: string; label: string }[]; title: string }) {
  return (
    <div>
      <p className="term-label mb-3">{title}</p>
      <ul className="space-y-2.5">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link className="text-[13.5px] text-[var(--term-fg)] transition hover:text-[var(--term-amber-text)]" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Footer() {
  return (
    <footer className="border-t border-[var(--term-line-strong)] bg-[var(--term-panel)] px-5 py-14 lg:px-8">
      <div className="mx-auto max-w-[80rem]">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          <div>
            <Link href="/">
              <HireovenLogo className="marketing-logo h-10 w-auto max-w-[180px]" variant="full" />
            </Link>
            <p className="mt-4 max-w-[18rem] text-[13.5px] leading-6 text-[var(--term-dim)]">
              Fresh jobs, sponsorship evidence, and AI application tools for people who want to apply early.
            </p>
          </div>
          <FooterColumn
            title="Product"
            links={[
              { href: "/find", label: "Find jobs" },
              { href: "/features", label: "Features" },
              { href: "/extension", label: "Extension" },
              { href: "/pricing", label: "Pricing" },
            ]}
          />
          <FooterColumn
            title="H-1B data"
            links={[
              { href: "/h1b-sponsors/leaderboard", label: "Sponsor leaderboard" },
              { href: "/h1b-sponsors/leaderboard/methodology", label: "Methodology" },
              { href: "/h1b-salaries", label: "H-1B salaries" },
              { href: "/companies", label: "Companies" },
            ]}
          />
          <FooterColumn
            title="Account"
            links={[
              { href: "/login", label: "Sign in" },
              { href: "/signup?next=%2Fdashboard%2Fonboarding", label: "Create account" },
              { href: "/support", label: "Support" },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { href: "/partners", label: "Partners" },
              { href: "/contact", label: "Contact" },
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ]}
          />
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--term-line)] pt-6">
          <p className="text-[12.5px] text-[var(--term-dim)]">
            © {new Date().getFullYear()} Hireoven. All rights reserved.
          </p>
          <div className="flex items-center gap-2 text-[12.5px] text-[var(--term-dim)]">
            <Check className="h-3.5 w-3.5 text-[var(--term-green)]" aria-hidden />
            Built for fast, evidence-backed applications.
          </div>
        </div>
      </div>
    </footer>
  )
}

export default async function HomePage() {
  const [stats, featured, stayStats, socRoles] = await Promise.all([
    getPlatformStats(),
    getFeaturedCompanies(),
    getCapExemptStats(),
    getFeaturedSocRoles(),
  ])
  const roleOptions = socRoles.map((r) => ({ socGroup: r.soc_group, label: r.short_label || r.label }))

  return (
    <div className="term-page min-h-dvh">
      <MaintenanceBanner />
      <AnnouncementBar />
      <Navbar />
      <HeroSection stats={stats} />
      <ImageCarouselSection />
      <StatBar stats={stats} />
      <TrustedBySection companies={featured} stats={stats} />
      <HowItWorksSection />
      <SponsorshipSection />
      <StaySection capExemptRoles={stayStats.openRoles} roleOptions={roleOptions} />
      <FeaturesSection />
      <ApexSection />
      <FinalCtaSection />
      <Footer />
    </div>
  )
}
