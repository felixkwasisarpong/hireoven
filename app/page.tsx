import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Bell,
  Bookmark,
  CheckCircle2,
  Clock,
  FileCheck2,
  Gauge,
  Globe,
  MousePointerClick,
  Sparkles,
  Target,
  Wand2,
  Zap,
} from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import ComingSoonSection from "@/components/marketing/ComingSoonSection"
import LogoWall from "@/components/marketing/LogoWall"
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Hireoven - Jobs served fresh. Apply before the crowd.",
  description:
    "Real-time job alerts, H-1B approval intelligence, one-click apply, and AI match scores. Built for fast, confident job hunting.",
}

export const dynamic = "force-dynamic"

// ─── Feature copy ────────────────────────────────────────────────────────────
// Benefit-first, never mechanism-first. The user cares about "I'll land
// interviews faster", not "Bayesian posterior over employer LCA history".

const CORE_FEATURES = [
  {
    icon: Zap,
    title: "Fresh jobs, before the crowd",
    body: "New roles land in your feed within minutes of going live. The first handful of applicants get the most eyes - we make sure you're in it.",
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
    body: "Greenhouse, Lever, Ashby, Workday - our autofill handles the tedious fields so you ship applications in seconds, not minutes.",
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
    body: "Follow companies you love. The moment they post, you hear about it - email, push, or right inside your dashboard.",
    accent: "text-rose-700",
    ring: "border-rose-200 bg-rose-50",
  },
] as const

const INTL_FEATURES = [
  {
    icon: Gauge,
    title: "H-1B approval likelihood",
    body: "Every role shows the odds that a sponsorship request there actually gets approved - not just whether the company will sponsor.",
  },
  {
    icon: Globe,
    title: "Sponsorship confidence score",
    body: "0–100 score for every company based on their actual hiring history. Stop guessing which employers will back you.",
  },
  {
    icon: Clock,
    title: "OPT & STEM OPT countdown",
    body: "The days left on your status are always visible in your dashboard. Urgency routing bubbles up the roles that move fastest.",
  },
] as const

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Build your profile in 2 minutes",
    body: "Upload your resume, pick your target roles, and set your location and visa status. That's it.",
  },
  {
    step: "02",
    title: "Your feed goes live instantly",
    body: "Matching roles start streaming in - ranked by fit, freshness, and (for international candidates) sponsorship odds.",
  },
  {
    step: "03",
    title: "Apply with one click",
    body: "Autofill pre-fills the form. Tailored cover letter ready. You hit send while the role is still fresh.",
  },
] as const

// ─── Data ────────────────────────────────────────────────────────────────────

type PlatformStats = {
  jobs: number
  companies: number
}

async function getPlatformStats(): Promise<PlatformStats> {
  if (!hasSupabaseAdminEnv()) return { jobs: 0, companies: 0 }
  try {
    const supabase = createAdminClient()
    const [jobs, companies] = await Promise.all([
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("companies").select("*", { count: "exact", head: true }).eq("is_active", true),
    ])
    return {
      jobs: jobs.count ?? 0,
      companies: companies.count ?? 0,
    }
  } catch {
    return { jobs: 0, companies: 0 }
  }
}

async function getFeaturedCompanies() {
  if (!hasSupabaseAdminEnv()) return []
  try {
    const supabase = createAdminClient()
    // We specifically want companies with a recognizable logo, so we require
    // a domain and order by job_count so the wall leans toward brands users
    // will actually know. 24 fills a 6-col grid with a comfortable 4 rows.
    const { data } = await supabase
      .from("companies")
      .select("id, name, domain, logo_url")
      .eq("is_active", true)
      .gt("job_count", 0)
      .not("domain", "is", null)
      .not("domain", "like", "%.uscis-employer")
      .not("domain", "like", "%.lca-employer")
      .order("job_count", { ascending: false })
      .limit(24)
    return data ?? []
  } catch {
    return []
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const [stats, featured] = await Promise.all([
    getPlatformStats(),
    getFeaturedCompanies(),
  ])
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {!user ? (
        <div className="border-b border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm">
          <Link
            href="/launch"
            className="font-semibold text-teal-800 transition hover:text-teal-950 hover:underline"
          >
            We&apos;re in early access - join the waitlist for founding member pricing
          </Link>
        </div>
      ) : null}

      {/* Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pb-20 pt-16 md:pb-28 md:pt-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(3,105,161,0.10),_transparent_55%)]"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[1.1fr,1fr]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#BAE6FD] bg-[#F0F9FF] px-4 py-1.5 text-xs font-semibold text-[#0369A1]">
              <span className="h-2 w-2 rounded-full bg-[#0369A1] animate-pulse" />
              Live monitoring active · {stats.jobs.toLocaleString()} jobs tracked
            </div>
            <h1 className="text-[2.75rem] font-extrabold leading-[1.05] tracking-tight text-gray-900 sm:text-5xl md:text-[3.5rem]">
              Jobs served fresh.{" "}
              <span className="bg-gradient-to-r from-[#0369A1] to-[#0EA5E9] bg-clip-text text-transparent">
                Apply before the crowd.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-gray-600 md:text-xl">
              Real-time job alerts, AI match scores, one-click apply, and H-1B
              approval intelligence - all in one place. Built for people who
              want interviews, not just applications.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0369A1] px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#0369A1]/25 transition hover:bg-[#075985]"
              >
                Get started free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/companies"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-7 py-3.5 text-base font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Browse companies
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
              <li className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Free forever plan
              </li>
              <li className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                No credit card
              </li>
              <li className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                2-minute setup
              </li>
            </ul>
          </div>

          {/* Product preview card - a mock, not a screenshot. Conveys value
              (match score + sponsorship + H-1B approval) without requiring
              asset maintenance. */}
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-[#0369A1]/15 via-sky-200/30 to-fuchsia-200/40 blur-2xl"
            />
            <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl shadow-slate-900/5">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                </div>
                <p className="text-xs font-medium text-gray-400">Your feed</p>
              </div>

              {/* Fake job card */}
              <div className="mt-4 rounded-2xl border border-gray-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0369A1] to-[#0EA5E9] text-sm font-bold text-white">
                    S
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      Senior Frontend Engineer
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      Stripe · San Francisco · Remote OK
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Fresh · 4m ago
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniStat label="Match" value="92" tone="violet" />
                  <MiniStat label="Sponsor" value="87" tone="blue" />
                  <MiniStat label="Approval" value="81" tone="emerald" />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500">
                    <MousePointerClick className="h-3 w-3" />
                    One-click apply ready
                  </span>
                  <span className="rounded-full bg-[#0369A1] px-3 py-1 text-[11px] font-semibold text-white">
                    Apply
                  </span>
                </div>
              </div>

              {/* Ghost second card */}
              <div className="mt-3 rounded-2xl border border-dashed border-gray-200 p-4 opacity-60">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gray-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-40 rounded bg-gray-100" />
                    <div className="h-2.5 w-24 rounded bg-gray-100" />
                  </div>
                </div>
              </div>

              <p className="mt-4 text-center text-[11px] text-gray-400">
                Your real feed updates in real time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof / logo wall ─────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-gray-50/70 py-14 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat value={stats.jobs.toLocaleString()} label="active jobs" />
            <Stat value={stats.companies.toLocaleString()} label="companies tracked" />
            <Stat value="<30m" label="avg. time to detection" />
            <Stat value="Realtime" label="feed updates" />
          </div>
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-widest text-gray-400">
            Tracking jobs at
          </p>
          {featured.length > 0 ? (
            <LogoWall companies={featured} />
          ) : (
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2">
              {["Stripe", "Meta", "Google", "Anthropic", "OpenAI", "Figma", "Databricks"].map((n) => (
                <span key={n} className="text-sm font-medium text-gray-400">{n}</span>
              ))}
            </div>
          )}
          <p className="mt-8 text-center text-xs text-gray-400">
            …and thousands more across Greenhouse, Lever, Ashby, and Workday.
          </p>
        </div>
      </section>

      {/* Core features grid ───────────────────────────────────────────────── */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
              Everything in one place
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              From job posted to apply sent - in the time it takes to pour a coffee
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              No more spreadsheets, browser tabs, or copy-pasting. Hireoven replaces
              the awkward stack you&apos;ve been duct-taping together.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {CORE_FEATURES.map(({ icon: Icon, title, body, accent, ring }) => (
              <div
                key={title}
                className="group relative rounded-3xl border border-gray-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-[#BAE6FD] hover:shadow-xl hover:shadow-slate-900/5"
              >
                <div className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl border ${ring}`}>
                  <Icon className={`h-5 w-5 ${accent}`} />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* International candidates ─────────────────────────────────────────── */}
      <section className="border-y border-[#E0F2FE] bg-[#F0F9FF] px-6 py-24">
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1fr,1.1fr] md:items-center">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
              For international candidates
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Know your odds before you spend the application
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Sponsorship confidence, H-1B approval likelihood, and visa language
              scanning - on every role. Stop burning time on companies that
              won&apos;t back you, and focus on the ones that will.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#075985]"
            >
              See sponsorship odds
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {INTL_FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-3xl border border-[#BAE6FD] bg-white p-6 shadow-sm"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E0F2FE]">
                  <Icon className="h-5 w-5 text-[#0369A1]" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{body}</p>
              </div>
            ))}
            <div className="rounded-3xl border border-dashed border-[#BAE6FD] bg-[#F0F9FF] p-6 sm:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
                Not legal advice
              </p>
              <p className="mt-1 text-sm text-[#0C4A6E]">
                Our signals help you prioritize where to apply. For anything
                binding on your case, talk to an immigration attorney.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works ─────────────────────────────────────────────────────── */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
              How it works
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Set it up once. Land interviews on autopilot.
            </h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {HOW_IT_WORKS.map(({ step, title, body }) => (
              <div key={step} className="relative rounded-3xl border border-gray-200 bg-white p-6">
                <span className="absolute -top-3 left-6 rounded-full bg-[#0369A1] px-3 py-0.5 text-[11px] font-bold text-white">
                  {step}
                </span>
                <h3 className="mb-2 mt-2 text-lg font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ComingSoonSection />

      {/* Final CTA ────────────────────────────────────────────────────────── */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-[#BAE6FD] bg-gradient-to-br from-[#F0F9FF] via-white to-sky-50 p-10 text-center md:p-14">
          <Bell className="mx-auto mb-5 h-8 w-8 text-[#0369A1]" />
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Stop finding out about jobs days late
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600">
            The first 10 applicants get the most attention. We make sure you&apos;re one of them.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-8 py-4 text-base font-semibold text-white shadow-lg shadow-[#0369A1]/25 transition hover:bg-[#075985]"
            >
              Sign up free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-8 py-4 text-base font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-xs text-gray-400">No credit card · Cancel anytime</p>
        </div>
      </section>

      {/* Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-[1.2fr,1fr,1fr,1fr]">
            <div>
              <p className="text-lg font-bold text-gray-900">Hireoven</p>
              <p className="mt-2 max-w-xs text-sm text-gray-500">
                Jobs served fresh. Built for job seekers, not recruiters.
              </p>
            </div>
            <FooterColumn
              title="Product"
              links={[
                { href: "/#features", label: "Features" },
                { href: "/companies", label: "Companies" },
                { href: "/pricing", label: "Pricing" },
              ]}
            />
            <FooterColumn
              title="Account"
              links={[
                { href: "/login", label: "Login" },
                { href: "/signup", label: "Sign up" },
                { href: "/launch", label: "Waitlist" },
              ]}
            />
            <FooterColumn
              title="Company"
              links={[
                { href: "/privacy", label: "Privacy" },
                { href: "/terms", label: "Terms" },
              ]}
            />
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-gray-100 pt-6 text-xs text-gray-400 sm:flex-row sm:items-center">
            <p>&copy; {new Date().getFullYear()} Hireoven. All rights reserved.</p>
            <p>Made for job seekers who move fast.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Local components ───────────────────────────────────────────────────────

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl font-bold text-[#0369A1] sm:text-4xl">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{label}</p>
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "violet" | "blue" | "emerald"
}) {
  const tones = {
    violet: "bg-violet-50 text-violet-700 border-violet-100",
    blue: "bg-sky-50 text-sky-700 border-sky-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  } as const
  return (
    <div className={`rounded-xl border px-2.5 py-2 text-center ${tones[tone]}`}>
      <p className="text-lg font-bold leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</p>
    </div>
  )
}

function FooterColumn({
  title,
  links,
}: {
  title: string
  links: Array<{ href: string; label: string }>
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        {title}
      </p>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="text-sm text-gray-500 transition hover:text-gray-900"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
