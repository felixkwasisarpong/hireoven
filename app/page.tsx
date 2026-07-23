import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import {
  ArrowRight,
  BellRing,
  Bot,
  BrainCircuit,
  Briefcase,
  Check,
  CheckCircle2,
  Chrome,
  Clock3,
  Code2,
  Database,
  FileCheck2,
  FileSearch,
  Gauge,
  Ghost,
  KeyRound,
  Layers3,
  Mic2,
  MousePointerClick,
  Radar,
  Search,
  ServerCog,
  ShieldCheck,
  Siren,
  Sparkles,
  Users,
  Webhook,
  Workflow,
} from "lucide-react"
import LandingParticleBackground from "@/components/marketing/LandingParticleBackground"
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
  title: "Hireoven - Job search on easy mode.",
  description:
    "Fresh job alerts, H-1B sponsorship intelligence, AI match scores, and one-click autofill for job seekers who want to apply first.",
}

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

type Stat = {
  value: string
  label: string
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

const apexCards = [
  {
    icon: Search,
    title: "Finds the openings worth your time",
    body: "Filter by freshness, sponsor strength, remote policy, role fit, salary evidence, and risk signals.",
  },
  {
    icon: FileCheck2,
    title: "Tailors your resume for the role",
    body: "Apex spots keyword gaps, rewrites bullets with your facts, and keeps every final edit in your control.",
  },
  {
    icon: MousePointerClick,
    title: "Autofills the application",
    body: "The extension fills repetitive fields across major ATS forms, then waits for your review before submission.",
  },
  {
    icon: BellRing,
    title: "Keeps the search moving",
    body: "Watchlists, reminders, and alerts keep high-fit jobs from going cold in another browser tab.",
  },
]

const candidateMoments = [
  {
    title: "Before applying",
    body: "Know whether the employer has sponsored similar roles before you spend an hour on the form.",
  },
  {
    title: "When a role opens",
    body: "Get the alert while the first batch of applicants is still forming, not after the job board catches up.",
  },
  {
    title: "At the application",
    body: "Autofill, tailored materials, and job-specific evidence stay in one workflow.",
  },
]

const workflowSteps = [
  {
    eyebrow: "01 Alert",
    title: "A fresh role lands before the job board crowd arrives.",
    body: "Hireoven watches company career pages directly, then sends openings into your radar while they are still early.",
    stat: "Minutes",
  },
  {
    eyebrow: "02 Evidence",
    title: "Sponsor history and role fit get checked in the same view.",
    body: "Apex pairs each opening with H-1B history, visa language, title match, skill overlap, and application risk.",
    stat: "Proof",
  },
  {
    eyebrow: "03 Apply",
    title: "The repetitive work is prepared before you open the form.",
    body: "Resume tailoring, field review, and autofill stay one step away, so you can move quickly without losing control.",
    stat: "Ready",
  },
]

const outcomeStats = [
  { value: "First", label: "batch awareness" },
  { value: "One", label: "place for evidence" },
  { value: "Less", label: "manual form work" },
]

const productSignals = [
  "Data Engineering",
  "Compliance",
  "PyTorch",
  "Python",
  "AWS",
]

const wowFeatureCards = [
  {
    icon: Bot,
    eyebrow: "Apex AI",
    title: "An autonomous search agent, not another chat box.",
    body: "Apex can research companies, build application queues, tailor materials, and operate the browser flow. Sensitive actions pause for approval, and final submission stays with you.",
    chips: ["Apply-agent", "Browser operator", "Career twin"],
    href: "/signup?next=%2Fdashboard%2Fapex",
  },
  {
    icon: Chrome,
    eyebrow: "Chrome extension",
    title: "One-click apply across the messy parts of ATS forms.",
    body: "Autofill packets, field review, and live match context travel with you across Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, BambooHR, and more.",
    chips: ["Autofill", "ATS support", "LinkedIn context"],
    href: "/extension",
  },
  {
    icon: Mic2,
    eyebrow: "Interview prep",
    title: "Voice and coding practice that follows the role.",
    body: "Practice with role-specific prompts, live voice sessions, coding interviews, scheduling, and AI debriefs that turn a rough answer into the next rep.",
    chips: ["Voice", "Coding", "Debrief"],
    href: "/signup?next=%2Fdashboard%2Finterview",
  },
  {
    icon: Ghost,
    eyebrow: "Ghost-job risk",
    title: "Spot postings that may not deserve your time.",
    body: "Timing, reposting, freshness, and employer signals help flag listings that look stale, recycled, or resume-collection heavy before you spend an application.",
    chips: ["Repost signals", "Timing", "Risk"],
    href: "/find",
  },
  {
    icon: Users,
    eyebrow: "Cohorts",
    title: "See the search through people with similar context.",
    body: "Layoff cohorts, peer movement, employer requests, and background-matched signals show where people like you are getting traction.",
    chips: ["Cohorts", "Layoff radar", "Peer signals"],
    href: "/signup?next=%2Fdashboard%2Fcohorts",
  },
  {
    icon: FileSearch,
    eyebrow: "Comp + scorecards",
    title: "The offer and sponsor story stay attached.",
    body: "H-1B wage data, salary comparisons, offer tracking, shareable sponsorability scorecards, and personal-brand modules keep the decision evidence in view.",
    chips: ["Wage data", "Scorecard", "Offer intel"],
    href: "/h1b-salaries",
  },
]

const missionDeckSteps = [
  { icon: Radar, label: "Career pages", value: "Tiered crawl" },
  { icon: ShieldCheck, label: "Sponsor proof", value: "DOL + USCIS" },
  { icon: BrainCircuit, label: "Apex prep", value: "Tailor + queue" },
  { icon: Code2, label: "Interview loop", value: "Voice + coding" },
]

const signalApiPillars = [
  {
    icon: KeyRound,
    title: "Tenant access",
    body: "API keys, tenant isolation, usage accounting, and quotas for partner integrations.",
  },
  {
    icon: Webhook,
    title: "Webhooks and embeds",
    body: "Push job and sponsor events into external workflows, then render company intelligence wherever customers need it.",
  },
  {
    icon: Database,
    title: "Real-time data product",
    body: "The same crawl, sponsorship, freshness, and role intelligence behind Hireoven can power a second B2B surface.",
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

function EmailCapture({ next = "/dashboard/onboarding" }: { next?: string }) {
  return (
    <form
      action="/signup"
      className="flex w-full max-w-[34rem] flex-col gap-2 sm:flex-row"
      method="get"
    >
      <input name="next" type="hidden" value={next} />
      <input
        aria-label="Email"
        className="min-h-[3rem] min-w-0 flex-1 border border-[rgba(120,200,160,0.26)] bg-[#0e1411] px-4 text-[14px] text-[#ccd6cf] outline-none transition placeholder:text-[#ccd6cf]/35 focus:border-[#38e08a]"
        name="email"
        placeholder="you@email.com"
        type="email"
      />
      <button className="term-btn term-btn-amber shrink-0 justify-center" type="submit">
        Get started
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </form>
  )
}

function AnnouncementBar() {
  return (
    <Link
      className="flex min-h-9 items-center justify-center gap-2 border-b border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-4 text-center text-[12.5px] text-[#ccd6cf]/70 transition hover:text-[#38e08a]"
      href="/extension"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#38e08a]" aria-hidden />
      Apex is live on Chrome
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  )
}

function HeroSection({ stats }: { stats: { jobs: number; companies: number } }) {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 pb-6 pt-12 sm:pt-16 lg:px-12">
      <p className="term-label inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#38e08a]" aria-hidden />
        &gt; {formatCount(stats.jobs, "10,000+")} live jobs tracked
      </p>

      <h1 className="mt-5 max-w-[34rem] text-[2.8rem] font-semibold leading-[1.02] tracking-tight text-white sm:text-[4rem] md:text-[4.6rem]">
        Job search, <span className="text-[#f5a623]">easy mode</span>
        <span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span>
      </h1>

      <p className="mt-6 max-w-[35rem] text-[15px] leading-relaxed text-[#ccd6cf]/70 md:text-[16px]">
        Fresh openings, sponsor intelligence, AI matching, and one-click autofill work together so you apply first with proof.
      </p>

      <div className="mt-8">
        <EmailCapture />
      </div>

      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
        {["No credit card", "Free job search", "H-1B evidence built in"].map((label) => (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#ccd6cf]/60" key={label}>
            <CheckCircle2 className="h-4 w-4 text-[#38e08a]" aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </section>
  )
}

function LogoCloud({ companies }: { companies: LogoCompany[] }) {
  const sourceCompanies = companies.length > 0 ? companies : fallbackCompanies
  const visibleCompanies = uniqueLogoCompanies(sourceCompanies).slice(0, 21)

  return (
    <div className="grid grid-cols-2 gap-px overflow-visible border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-3 lg:grid-cols-7">
      {visibleCompanies.map((company, index) => {
        const proof = companyProof(company)

        return (
          <Link
            aria-label={`View ${company.name}`}
            className="term-panel-hover group relative z-0 flex min-h-[84px] cursor-pointer items-center justify-center gap-2 bg-[#0e1411] px-4 py-4 hover:z-20 focus-visible:z-20 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#38e08a]"
            href={companyHref(company)}
            key={company.id}
            title={company.name}
          >
            {isLocalCompanyLogo(company.logo_url) ? (
              <Image
                alt={company.name}
                className="h-8 w-8 object-contain opacity-70 transition duration-200 group-hover:opacity-100"
                height={32}
                src={company.logo_url ?? ""}
                width={32}
              />
            ) : (
              <CompanyLogo
                className="h-8 w-8 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] opacity-80 transition duration-200 group-hover:opacity-100"
                companyName={company.name}
                domain={company.domain}
                logoUrl={company.logo_url}
                priority={index < 7}
              />
            )}
            <span className="max-w-[7rem] truncate text-[12.5px] font-medium text-[#ccd6cf]/70 transition group-hover:text-white">
              {company.name}
            </span>

            <span className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-30 hidden w-[17rem] -translate-x-1/2 translate-y-1 border border-[rgba(120,200,160,0.26)] bg-[#0e1411] p-4 text-left opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:block">
              <span className="flex items-center gap-3 border-b border-[rgba(120,200,160,0.12)] pb-3">
                {isLocalCompanyLogo(company.logo_url) ? (
                  <Image
                    alt=""
                    className="h-8 w-8 object-contain"
                    height={32}
                    src={company.logo_url ?? ""}
                    width={32}
                  />
                ) : (
                  <CompanyLogo
                    className="h-8 w-8 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
                    companyName={company.name}
                    domain={company.domain}
                    logoUrl={company.logo_url}
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-white">{company.name}</span>
                  <span className="block truncate text-[11px] text-[#ccd6cf]/45">{proof.source}</span>
                </span>
              </span>

              <span className="mt-3 grid grid-cols-2 gap-2">
                <span className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-3">
                  <span className="term-label block">{proof.primaryLabel}</span>
                  <span className="mt-1 block text-[18px] font-semibold tabular-nums text-[#38e08a]">
                    {proof.primary}
                  </span>
                </span>
                <span className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-3">
                  <span className="term-label block">{proof.sponsorLabel}</span>
                  <span className="mt-1 block text-[14px] font-semibold tabular-nums text-[#38e08a]">
                    {proof.sponsorValue}
                  </span>
                </span>
              </span>

              <span className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[#ccd6cf]/45">
                <span>{proof.footer}</span>
                <span className="inline-flex items-center gap-1 text-[#f5a623]">
                  View
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </span>
            </span>

            <ArrowRight
              className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#ccd6cf]/35 opacity-0 transition group-hover:translate-x-1 group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden
            />
          </Link>
        )
      })}
    </div>
  )
}

function LogoProofSection({
  companies,
  stats,
}: {
  companies: LogoCompany[]
  stats: { jobs: number; companies: number }
}) {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-10 lg:px-12">
      <p className="term-label mb-4">{"// tracked_companies"}</p>
      <LogoCloud companies={companies} />
      <p className="mt-6 text-center text-[12.5px] text-[#ccd6cf]/55">
        Tracking {formatCount(stats.companies, "1,000+")} companies across Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, Jobvite, SuccessFactors, and more.
      </p>
      <p className="mx-auto mt-2 max-w-[46rem] text-center text-[11.5px] leading-5 text-[#ccd6cf]/40">
        Hover facts use Hireoven&apos;s current company crawl plus public H-1B employer records. Sponsorship support still depends on the specific role.
      </p>
    </section>
  )
}

function MetricStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {stats.map(({ value, label }) => (
        <div className="min-w-0 border-t border-[rgba(120,200,160,0.26)] pt-5" key={label}>
          <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(2.4rem,4vw,3rem)] font-semibold leading-none tabular-nums text-[#38e08a]">
            {value}
          </p>
          <p className="term-label mt-2">{label}</p>
        </div>
      ))}
    </div>
  )
}

function ProductShowcaseImage() {
  return (
    <div className="space-y-4">
      <div className="term-panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[rgba(120,200,160,0.12)] px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-[#38e08a]" aria-hidden />
          <span className="term-label">apex --autofill</span>
        </div>
        <div className="relative aspect-[16/10] w-full bg-[#0a0e0c]">
          <Image
            alt="Apex autofill preview on a job application page"
            className="object-cover object-center"
            fill
            sizes="(min-width: 1024px) 48vw, 100vw"
            src="/extension/autofill-drawer.png"
          />
        </div>
      </div>

      <div className="term-panel p-4 sm:p-5">
        <div className="flex items-center justify-between border-b border-[rgba(120,200,160,0.12)] pb-3">
          <p className="term-label">analysis</p>
          <span className="term-label">apex</span>
        </div>

        <div className="grid grid-cols-[6.5rem_1fr] gap-y-2 py-4 text-[12.5px]">
          <span className="text-[#ccd6cf]/50">Match score</span>
          <span className="font-semibold tabular-nums text-[#38e08a]">71%</span>
          <span className="text-[#ccd6cf]/50">Source</span>
          <span className="font-medium text-[#ccd6cf]">Greenhouse</span>
          <span className="text-[#ccd6cf]/50">Autofill</span>
          <span className="font-medium text-[#ccd6cf]">Supported</span>
          <span className="text-[#ccd6cf]/50">Sponsor check</span>
          <span className="font-medium text-[#ccd6cf]">Evidence found</span>
        </div>

        <div className="border-t border-[rgba(120,200,160,0.12)] pt-3">
          <p className="term-label mb-2">matched signals</p>
          <div className="space-y-1">
            {productSignals.map((signal, index) => (
              <div
                className={[
                  "h-7 items-center justify-between border border-[rgba(120,200,160,0.12)] bg-[#0a0e0c] px-3 text-[11.5px] font-medium text-[#ccd6cf]/80",
                  index > 2 ? "hidden sm:flex" : "flex",
                ].join(" ")}
                key={signal}
              >
                {signal}
                <span className="border border-[#f5a623]/30 px-1.5 text-[9px] font-bold text-[#f5a623]">H</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border border-[rgba(120,200,160,0.12)] bg-[#0a0e0c] p-1.5 text-[10px]">
          <span className="inline-flex h-6 items-center gap-2 whitespace-nowrap border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2 font-semibold text-[#ccd6cf]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#38e08a]" aria-hidden />
            Apex
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-[#ccd6cf]/35 sm:block">AI enabled on this form</span>
          <span className="hidden border border-[rgba(120,200,160,0.2)] px-2 py-1 font-semibold text-[#ccd6cf]/70 sm:inline-flex">
            Save
          </span>
          <span className="border border-[#f5a623]/30 px-2 py-1 font-semibold text-[#f5a623]">Analyze</span>
          <span className="border border-[#f5a623]/30 px-2 py-1 font-bold uppercase tracking-[0.08em] text-[#f5a623]">
            Autofill supported
          </span>
        </div>
      </div>
    </div>
  )
}

function CompaniesSection({ stats }: { stats: { jobs: number; companies: number } }) {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="grid gap-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div>
          <p className="term-label">{"// for_job_seekers"}</p>
          <h2 className="mt-4 max-w-[42rem] text-[2rem] font-semibold leading-[1.05] tracking-tight text-white md:text-[3rem]">
            A hiring radar that understands exactly what you <span className="text-[#f5a623]">need</span>.
          </h2>
          <p className="mt-6 max-w-[36rem] text-[15px] leading-relaxed text-[#ccd6cf]/70">
            Hireoven watches company career pages, ranks openings by your profile, and brings sponsor evidence into the same view.
          </p>

          <div className="mt-10">
            <MetricStrip
              stats={[
                { value: formatCompactCount(stats.jobs, "10k+"), label: "active jobs monitored" },
                { value: "2m", label: "typical setup time" },
                { value: "1", label: "workflow from alert to application" },
              ]}
            />
          </div>
        </div>

        <ProductShowcaseImage />
      </div>
    </section>
  )
}

function WorkflowStorySection() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
        <div>
          <p className="term-label">{"// how_it_moves"}</p>
          <h2 className="mt-4 max-w-[40rem] text-[2rem] font-semibold leading-[1.06] tracking-tight text-white md:text-[3rem]">
            From market signal to <span className="text-[#f5a623]">ready-to-review</span> application.
          </h2>
          <p className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-[#ccd6cf]/70">
            Hireoven is built around the actual rhythm of a job search: finding the opening early, understanding whether it is worth it, and preparing the work before momentum fades.
          </p>
        </div>

        <div className="term-panel p-5">
          <div className="mb-3 flex items-center gap-2 border-b border-[rgba(120,200,160,0.12)] pb-2">
            <span className="h-2 w-2 rounded-full bg-[#38e08a]" aria-hidden />
            <span className="term-label">pipeline --live</span>
          </div>
          <div className="grid gap-px border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-3">
            {["Fresh role", "Sponsor check", "Apex prep"].map((label, index) => (
              <div className="bg-[#0e1411] p-4" key={label}>
                <p className="term-label">step {index + 1}</p>
                <p className="mt-1 text-[14px] font-semibold text-white">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {workflowSteps.map((step) => (
          <div className="term-panel p-6" key={step.eyebrow}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-[0.7rem] font-semibold tracking-wide text-[#f5a623]">{step.eyebrow}</p>
              <span className="term-label border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-2 py-1">{step.stat}</span>
            </div>
            <h3 className="mt-6 text-[1.25rem] font-semibold leading-tight tracking-tight text-white">{step.title}</h3>
            <p className="mt-3 text-[13px] leading-6 text-[#ccd6cf]/65">{step.body}</p>
          </div>
        ))}
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
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="mx-auto max-w-[46rem] text-center">
        <p className="term-label">{"> stay --survival-odds --rules=2026"}</p>
        <h2 className="mt-4 text-[2rem] font-semibold leading-[1.06] tracking-tight text-white md:text-[3rem]">
          Will this job actually <span className="text-[#f5a623]">keep you in the country?</span>
        </h2>
        <p className="mt-5 text-[15px] leading-relaxed text-[#ccd6cf]/70">
          The 2026 rules changed the H-1B math. Stay scores every job by your real odds of building a lasting career
          here — and surfaces the roles that skip the lottery entirely.
        </p>
      </div>

      <div className="mx-auto mt-10 max-w-[78rem]">
        <StayDemo capExemptRoles={capExemptRoles} roleOptions={roleOptions} />
      </div>

      <div className="mt-6 flex justify-center">
        <Link href="/stay" className="term-btn term-btn-amber">
          Open the full Stay toolkit
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  )
}

function ApexCard({
  body,
  icon: Icon,
  title,
}: {
  body: string
  icon: LucideIcon
  title: string
}) {
  return (
    <div className="term-panel p-6">
      <span className="flex h-10 w-10 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-6 text-[16px] font-semibold text-white">{title}</h3>
      <p className="mt-3 text-[13px] leading-6 text-[#ccd6cf]/65">{body}</p>
    </div>
  )
}

function ApexSection() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div>
          <p className="term-label inline-flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[#f5a623]" aria-hidden />
            apex_ai
          </p>
          <h2 className="mt-4 max-w-[38rem] text-[2rem] font-semibold leading-[1.06] tracking-tight text-white md:text-[3rem]">
            The busy work <span className="text-[#f5a623]">leaves your search</span>.
          </h2>
          <p className="mt-5 max-w-[35rem] text-[15px] leading-relaxed text-[#ccd6cf]/70">
            Apex handles research, tailoring, and application prep while you stay in control of the decisions that matter.
          </p>

          <div className="mt-9 w-full max-w-[34rem]">
            <EmailCapture />
          </div>
          <p className="term-label mt-4">{"free plan available // paid plans start at $19/month"}</p>
        </div>

        <div className="term-panel p-5">
          <div className="flex items-center justify-between gap-4 border-b border-[rgba(120,200,160,0.12)] pb-3">
            <p className="term-label">apex runbook</p>
            <span className="term-label inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#38e08a]" aria-hidden />
              live
            </span>
          </div>
          <div className="mt-4 grid gap-px border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-3">
            {["Scan role", "Tailor resume", "Review fields"].map((label) => (
              <div className="bg-[#0e1411] px-3 py-4" key={label}>
                <p className="text-[13px] font-semibold text-white">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        {apexCards.map((card) => (
          <ApexCard key={card.title} {...card} />
        ))}
      </div>
    </section>
  )
}

function MissionDeckVisual() {
  return (
    <div className="term-panel p-5">
      <div className="flex items-center justify-between gap-4 border-b border-[rgba(120,200,160,0.12)] pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
            <Workflow className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="term-label">job-search os</p>
            <p className="text-[14px] font-semibold text-white">Live mission deck</p>
          </div>
        </div>
        <span className="term-label inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#38e08a]" aria-hidden />
          active
        </span>
      </div>

      <div className="mt-5 grid gap-px border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-2">
        {missionDeckSteps.map(({ icon: Icon, label, value }) => (
          <div className="bg-[#0e1411] p-4" key={label}>
            <Icon className="h-5 w-5 text-[#f5a623]" aria-hidden />
            <p className="term-label mt-4">{label}</p>
            <p className="mt-1 text-[16px] font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="term-label">queue</p>
          <span className="inline-flex items-center gap-1.5 text-[0.7rem] tracking-wide text-[#f5a623]">
            <Layers3 className="h-3.5 w-3.5" aria-hidden />
            4 systems
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {[
            ["Fresh role found", "Career page source checked"],
            ["Apex packet ready", "Resume, cover letter, autofill"],
            ["Interview loop generated", "Voice + coding prep"],
          ].map(([title, body]) => (
            <div className="flex items-center gap-3 border border-[rgba(120,200,160,0.12)] bg-[#0e1411] px-3 py-3" key={title}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#38e08a]" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-white">{title}</span>
                <span className="block truncate text-[11px] text-[#ccd6cf]/45">{body}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 border border-[#f5a623]/25 bg-[#f5a623]/10 p-4">
        <Siren className="mt-0.5 h-4 w-4 shrink-0 text-[#f5a623]" aria-hidden />
        <p className="text-[12px] leading-5 text-[#ccd6cf]/70">
          Watched-company alerts, WARN/layoff signals, salary movement, and quota-backed API events can all be part of the same intelligence loop.
        </p>
      </div>
    </div>
  )
}

function WowFeatureCard({
  body,
  chips,
  eyebrow,
  href,
  icon: Icon,
  title,
}: (typeof wowFeatureCards)[number]) {
  return (
    <Link className="term-panel term-panel-hover group block p-6" href={href}>
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-10 w-10 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <ArrowRight className="h-4 w-4 text-[#ccd6cf]/35 transition group-hover:translate-x-1 group-hover:text-[#38e08a]" aria-hidden />
      </div>
      <p className="mt-6 text-[0.7rem] font-semibold tracking-wide text-[#f5a623]">{eyebrow}</p>
      <h3 className="mt-2 text-[18px] font-semibold leading-tight tracking-tight text-white">{title}</h3>
      <p className="mt-3 text-[13px] leading-6 text-[#ccd6cf]/65">{body}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-2.5 py-1 text-[11px] text-[#ccd6cf]/70" key={chip}>
            {chip}
          </span>
        ))}
      </div>
    </Link>
  )
}

function BeyondRadarSection() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="grid gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <div>
          <p className="term-label inline-flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[#f5a623]" aria-hidden />
            beyond_the_radar
          </p>
          <h2 className="mt-4 max-w-[40rem] text-[2rem] font-semibold leading-[1.06] tracking-tight text-white md:text-[3rem]">
            The search becomes a full <span className="text-[#f5a623]">operating system</span>.
          </h2>
          <p className="mt-5 max-w-[36rem] text-[15px] leading-relaxed text-[#ccd6cf]/70">
            The job and sponsorship feed is the front door. Behind it sits Apex, autofill, interview prep, ghost-risk detection, cohorts, salary evidence, alerts, and scorecards in one loop.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              { label: "Fast-tier boards checked within minutes", icon: Radar },
              { label: "Sensitive Apex actions require approval", icon: ShieldCheck },
              { label: "Interview, salary, and cohort context stay attached", icon: BrainCircuit },
              { label: "Chrome extension carries the workflow across ATS pages", icon: Chrome },
            ].map(({ icon: Icon, label }) => (
              <div className="flex items-center gap-3 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-4 py-3" key={label}>
                <Icon className="h-4 w-4 shrink-0 text-[#f5a623]" aria-hidden />
                <span className="text-[12.5px] font-medium text-[#ccd6cf]">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <MissionDeckVisual />
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {wowFeatureCards.map((card) => (
          <WowFeatureCard key={card.title} {...card} />
        ))}
      </div>
    </section>
  )
}

function SignalApiSection() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="term-label inline-flex items-center gap-2">
            <ServerCog className="h-3.5 w-3.5 text-[#f5a623]" aria-hidden />
            signal_api
          </p>
          <h2 className="mt-4 max-w-[39rem] text-[2rem] font-semibold leading-[1.06] tracking-tight text-white md:text-[3rem]">
            A second product hiding inside the <span className="text-[#f5a623]">intelligence engine</span>.
          </h2>
          <p className="mt-5 max-w-[35rem] text-[15px] leading-relaxed text-[#ccd6cf]/70">
            Hireoven&apos;s job freshness, sponsor evidence, company signals, embeds, webhooks, quotas, and tenant controls can serve other products too.
          </p>

          <div className="mt-9 grid gap-3">
            {signalApiPillars.map(({ body, icon: Icon, title }) => (
              <div className="term-panel flex gap-4 p-4" key={title}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-[14px] font-semibold text-white">{title}</h3>
                  <p className="mt-1 text-[13px] leading-6 text-[#ccd6cf]/60">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="term-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[rgba(120,200,160,0.12)] px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ccd6cf]/25" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-[#f5a623]" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-[#38e08a]" aria-hidden />
            </div>
            <span className="term-label">tenant: production</span>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1fr_0.78fr]">
            <div className="border-b border-[rgba(120,200,160,0.12)] p-5 lg:border-b-0 lg:border-r">
              <p className="term-label">event stream</p>
              <pre className="mt-4 overflow-x-auto text-[12px] leading-6 text-[#38e08a]">
{`POST /api/signal/v1/jobs/ingest
{
  "company": "Anthropic",
  "freshness": "new",
  "sponsorSignal": 100,
  "ats": "greenhouse",
  "webhooks": ["job.created"]
}`}
              </pre>
            </div>
            <div className="p-5">
              <p className="term-label">controls</p>
              <div className="mt-4 space-y-2">
                {[
                  ["API keys", "active"],
                  ["Quotas", "metered"],
                  ["Embeds", "ready"],
                  ["Webhooks", "queued"],
                ].map(([label, value]) => (
                  <div className="flex items-center justify-between border border-[rgba(120,200,160,0.12)] bg-[#0a0e0c] px-3 py-2 text-[12px]" key={label}>
                    <span className="font-medium text-[#ccd6cf]">{label}</span>
                    <span className="text-[#ccd6cf]/45">{value}</span>
                  </div>
                ))}
              </div>
              <Link
                className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
                href="/embed/docs"
              >
                View API surface
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function CandidateJourneyBoard() {
  const moments = [
    {
      icon: ShieldCheck,
      label: "Before applying",
      title: "Sponsorability check",
      body: "H-1B history, OPT fit, and visa language are attached before you commit time.",
      metric: "88 score",
    },
    {
      icon: BellRing,
      label: "When a role opens",
      title: "Fresh alert",
      body: "Watched companies move from crawl to alert while the applicant batch is still forming.",
      metric: "7m old",
    },
    {
      icon: MousePointerClick,
      label: "At the application",
      title: "Review gate",
      body: "Apex prepares materials and autofill answers, then waits for explicit approval.",
      metric: "You OK",
    },
  ]

  return (
    <div className="term-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(120,200,160,0.12)] pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
            <Workflow className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="term-label truncate">candidate journey</p>
            <p className="truncate text-[14px] font-semibold text-white">Signal to submitted application</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#38e08a]" aria-hidden />
          <span className="h-2 w-2 rounded-full bg-[#38e08a]" aria-hidden />
          <span className="h-2 w-2 rounded-full bg-[#ccd6cf]/25" aria-hidden />
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(18rem,1fr)]">
        <div className="space-y-3">
          {moments.map(({ body, icon: Icon, label, metric, title }) => (
            <div className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4" key={label}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#f5a623]">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="term-label truncate">{label}</p>
                    <span className="shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[#38e08a]">{metric}</span>
                  </div>
                  <h3 className="mt-2 text-[15px] font-semibold text-white">{title}</h3>
                  <p className="mt-1.5 text-[12px] leading-5 text-[#ccd6cf]/55">{body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="term-label">apex handoff</p>
            <span className="term-label inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#38e08a]" aria-hidden />
              ready
            </span>
          </div>

          <div className="mt-5 border border-[rgba(120,200,160,0.12)] bg-[#0e1411] p-4">
            <p className="text-[13px] font-semibold text-white">Staff ML Platform Engineer</p>
            <p className="mt-1 text-[12px] text-[#ccd6cf]/45">Career page source · first detected 7 minutes ago</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["Match", "71%"],
                ["Sponsor", "Strong"],
                ["Risk", "Low"],
              ].map(([label, value]) => (
                <div className="border border-[rgba(120,200,160,0.12)] bg-[#0a0e0c] px-3 py-3" key={label}>
                  <p className="term-label">{label}</p>
                  <p className="mt-1 truncate text-[13px] font-semibold text-[#38e08a]">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {[
              ["Resume", "Tailored to role keywords"],
              ["Cover letter", "Drafted with company context"],
              ["Autofill", "Fields prepared for review"],
              ["Submit", "Locked until your approval"],
            ].map(([label, value], index) => (
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border border-[rgba(120,200,160,0.12)] bg-[#0e1411] px-3 py-2" key={label}>
                <span className={["h-1.5 w-1.5 rounded-full", index === 3 ? "bg-[#f5a623]" : "bg-[#ccd6cf]/30"].join(" ")} aria-hidden />
                <span className="truncate text-[12px] font-medium text-[#ccd6cf]">{label}</span>
                <span className="hidden truncate text-[11px] text-[#ccd6cf]/40 sm:block">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function CandidateMomentsSection() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="grid gap-12 lg:grid-cols-[0.86fr_1.14fr] lg:items-center">
        <div>
          <p className="term-label">{"// candidate_moments"}</p>
          <h2 className="mt-4 max-w-[39rem] text-[2rem] font-semibold leading-[1.06] tracking-tight text-white md:text-[2.8rem]">
            Built for the points where searches usually <span className="text-[#f5a623]">slow down</span>.
          </h2>
          <div className="mt-8 space-y-5">
            {candidateMoments.map(({ body, title }) => (
              <div className="border-l border-[rgba(120,200,160,0.26)] pl-5" key={title}>
                <h3 className="text-[15px] font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-6 text-[#ccd6cf]/65">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <CandidateJourneyBoard />
      </div>
    </section>
  )
}

function OutcomeSection() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="term-panel p-6 sm:p-8">
          <div className="flex items-center gap-2 border-b border-[rgba(120,200,160,0.12)] pb-3">
            <span className="h-2 w-2 rounded-full bg-[#38e08a]" aria-hidden />
            <span className="term-label">outcome</span>
          </div>
          <p className="mt-5 text-[1.6rem] font-semibold leading-tight tracking-tight text-white">
            When the right role opens, you already know what to do <span className="text-[#f5a623]">next</span>.
          </p>
        </div>

        <div>
          <p className="term-label">{"// what_changes"}</p>
          <h2 className="mt-4 max-w-[40rem] text-[2rem] font-semibold leading-[1.06] tracking-tight text-white md:text-[3rem]">
            The search feels less like checking boards and more like <span className="text-[#f5a623]">operating a pipeline</span>.
          </h2>
          <p className="mt-5 max-w-[35rem] text-[15px] leading-relaxed text-[#ccd6cf]/70">
            You still make the judgment calls. Hireoven keeps the timing, evidence, and application prep moving around those decisions.
          </p>

          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {outcomeStats.map(({ label, value }) => (
              <div className="border-t border-[rgba(120,200,160,0.26)] pt-5" key={label}>
                <p className="text-[2.4rem] font-semibold leading-none tabular-nums text-[#38e08a]">{value}</p>
                <p className="term-label mt-2">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalCtaSection() {
  return (
    <section className="mx-auto w-full max-w-[88rem] px-5 py-20 lg:px-12">
      <div className="term-panel mx-auto flex max-w-[48rem] flex-col items-center p-8 text-center sm:p-12">
        <span className="flex h-11 w-11 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
          <Briefcase className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="mt-6 text-[2rem] font-semibold leading-[1.05] tracking-tight text-white md:text-[3rem]">
          Stop finding out about jobs <span className="text-[#f5a623]">days late</span>.
        </h2>
        <p className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-[#ccd6cf]/70">
          Let Hireoven watch the market, check the evidence, and prepare the application while the role is still fresh.
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
            <Link className="text-[13px] text-[#ccd6cf]/55 transition hover:text-[#38e08a]" href={href}>
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
    <footer className="border-t border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] px-5 py-16 lg:px-12">
      <div className="mx-auto max-w-[88rem]">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          <div>
            <Link href="/">
              <HireovenLogo className="h-10 w-auto max-w-[180px] [filter:brightness(0)_invert(1)]" variant="full" />
            </Link>
            <p className="mt-4 max-w-[18rem] text-[13px] leading-6 text-[#ccd6cf]/55">
              Fresh jobs, sponsor proof, and AI application workflows for job seekers who move early.
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

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[rgba(120,200,160,0.12)] pt-6">
          <p className="text-[12px] text-[#ccd6cf]/40">© {new Date().getFullYear()} Hireoven. All rights reserved.</p>
          <div className="flex items-center gap-2 text-[12px] text-[#ccd6cf]/40">
            <Check className="h-3.5 w-3.5 text-[#38e08a]" aria-hidden />
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
    <div className="term-page relative min-h-dvh overflow-hidden">
      <LandingParticleBackground />
      <div className="relative z-10">
        <MaintenanceBanner />
        <AnnouncementBar />
        <Navbar />
        <HeroSection stats={stats} />
        <LogoProofSection companies={featured} stats={stats} />
        <CompaniesSection stats={stats} />
        <WorkflowStorySection />
        <StaySection capExemptRoles={stayStats.openRoles} roleOptions={roleOptions} />
        <BeyondRadarSection />
        <ApexSection />
        <CandidateMomentsSection />
        <SignalApiSection />
        <OutcomeSection />
        <FinalCtaSection />
        <Footer />
      </div>
    </div>
  )
}
