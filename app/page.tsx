import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, CheckCircle2, ShieldCheck, Sparkles, Users, Zap } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import LogoWall from "@/components/marketing/LogoWall"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import HireovenLogo from "@/components/ui/HireovenLogo"
import MaintenanceBanner from "@/components/marketing/MaintenanceBanner"

export const revalidate = 300

export const metadata: Metadata = {
  title: "Hireoven — Fresh jobs, checked for H-1B sponsorship.",
  description:
    "Real-time job alerts and AI match scores, with H-1B sponsorship intelligence — petition history and visa-language signals — on every role. Plus one-click apply and Apex AI for your whole search.",
}


// ── Data ─────────────────────────────────────────────────────────────────────

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
  } catch { return { jobs: 0, companies: 0 } }
}

async function getFeaturedCompanies() {
  if (!hasPostgresEnv()) return []
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ id: string; name: string; domain: string; logo_url: string | null }>(
      `SELECT id, name, domain, logo_url FROM companies
       WHERE is_active = true AND job_count > 0 AND domain IS NOT NULL
         AND domain NOT ILIKE '%.uscis-employer' AND domain NOT ILIKE '%.lca-employer'
       ORDER BY
         CASE
           WHEN logo_url ILIKE '/company-logos/%' THEN 0
           WHEN logo_url ILIKE 'https://img.logo.dev/%' THEN 0
           WHEN logo_url IS NULL OR logo_url = '' THEN 1
           WHEN logo_url ILIKE '%google.com/s2/favicons%' THEN 2
           WHEN logo_url ILIKE '%gstatic.com/faviconV2%' THEN 2
           ELSE 1
         END ASC,
         job_count DESC
       LIMIT 24`
    )
    return rows
  } catch { return [] }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl font-black tracking-tight text-white sm:text-4xl">{value}</p>
      <p className="mt-1 text-[13px] text-white/50">{label}</p>
    </div>
  )
}

function FeatureCard({
  icon, title, body, accent, color,
}: {
  icon: string; title: string; body: string; accent?: string; color?: string
}) {
  const bg = color ?? "#FF5C18"
  return (
    <div className="group flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white/80 p-5 backdrop-blur-sm shadow-[0_2px_16px_rgba(99,102,241,0.06)] transition hover:shadow-[0_8px_32px_rgba(99,102,241,0.12)] hover:-translate-y-0.5">
      {/* Coloured icon square */}
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-xl"
        style={{ background: `${bg}18`, border: `1px solid ${bg}25` }}>
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-bold text-slate-700">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{body}</p>
      </div>
      {accent && (
        <span className="self-start rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
          style={{ background: `${bg}12`, color: bg }}>
          {accent}
        </span>
      )}
    </div>
  )
}

function PlanCard({
  name, price, note, features, highlight, badge,
}: {
  name: string; price: string; note: string; features: string[]; highlight?: boolean; badge?: string
}) {
  return (
    <div className={[
      "relative flex flex-col overflow-hidden rounded-2xl border p-6",
      highlight
        ? "border-[#FF5C18]/40 bg-white shadow-[0_8px_40px_rgba(255,92,24,0.14)]"
        : "border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]",
    ].join(" ")}>
      <div className="absolute inset-x-0 top-0 h-0.5" style={{
        background: highlight
          ? "linear-gradient(90deg,#FF5C18,#FF9A3C)"
          : "linear-gradient(90deg,#7C3AED,#C026D3)",
      }} />
      {badge && (
        <span className="absolute right-4 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
          style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}>
          {badge}
        </span>
      )}
      <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-400">{name}</p>
      <div className="mt-2 flex items-end gap-1">
        <span className="text-[30px] font-black tabular-nums text-slate-900">{price}</span>
        {price !== "Free" && <span className="mb-1.5 text-[13px] text-slate-400">/mo</span>}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>
      <ul className="mt-5 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[12.5px] text-slate-600">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF5C18]" strokeWidth={3} />
            {f}
          </li>
        ))}
      </ul>
      <Link
        href="/signup"
        className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-bold text-white transition"
        style={{
          background: highlight
            ? "linear-gradient(135deg,#FF5C18,#FF7A35)"
            : "linear-gradient(135deg,#7C3AED,#C026D3)",
        }}
      >
        Get started
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
      <ul className="space-y-2">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} className="text-[13px] text-slate-500 transition hover:text-slate-900">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const [stats, featured] = await Promise.all([getPlatformStats(), getFeaturedCompanies()])

  return (
    <div className="min-h-screen bg-white">
      <MaintenanceBanner />
      <Navbar />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-slate-100 bg-white">

        {/* Soft light accents */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-40 h-[440px] w-[440px] rounded-full bg-[#FF5C18]/5 blur-[120px]" />
          <div className="absolute right-0 top-0 h-[360px] w-[360px] rounded-full bg-emerald-500/5 blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 md:pb-28 md:pt-24">
          <div className="mx-auto max-w-3xl text-center">

            {/* Live badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live · {stats.jobs > 0 ? stats.jobs.toLocaleString() : "10,000+"} jobs tracked right now
            </div>

            <h1 className="text-[2.8rem] font-black leading-[1.05] tracking-tight text-slate-950 sm:text-5xl md:text-[3.75rem]">
              Know they sponsor{" "}
              <span className="text-[#FF5C18]">before</span>{" "}
              you apply.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 md:text-xl">
              Every listing checked against real DOL and USCIS petition records. Every opening
              surfaced minutes after it posts. Apex applies for you with a tailored resume — so you
              show up first, with proof instead of hope.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/signup"
                className="inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-8 py-4 text-base font-bold text-white shadow-[0_8px_30px_rgba(255,92,24,0.35)] transition hover:brightness-110">
                Get started free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/find"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-8 py-4 text-base font-semibold text-slate-700 transition hover:bg-slate-50">
                Search jobs free
              </Link>
            </div>

            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {["Free to start", "No credit card", "Set up in 2 minutes"].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5 text-sm text-slate-400">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Workflow: detected → checked → applied */}
          <div className="mx-auto mt-16 max-w-5xl">
            <div className="grid gap-3 md:grid-cols-[1fr,auto,1fr,auto,1fr] md:items-stretch">

              {/* Step 1: job detected */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">1 · Job detected</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FF5C18] text-sm font-black text-white">
                    S
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-slate-900">Senior Frontend Engineer</p>
                    <p className="text-[11.5px] text-slate-400">Stripe · Remote · $180k+</p>
                  </div>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Posted 2 minutes ago
                </span>
                <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
                  Straight from the company&apos;s career page, before job boards index it.
                </p>
              </div>

              <div className="hidden items-center md:flex" aria-hidden>
                <ArrowRight className="h-5 w-5 text-slate-300" />
              </div>

              {/* Step 2: sponsorship checked */}
              <div className="rounded-2xl border-2 border-[#FF5C18]/30 bg-white p-5 shadow-[0_8px_40px_rgba(255,92,24,0.10)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">2 · Sponsorship checked</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[["Sponsor", "89", "#FF5C18"], ["Petitions", "412", "#7C3AED"], ["Approval", "81%", "#059669"]].map(([l, v, c]) => (
                    <div key={l} className="rounded-lg bg-slate-50 px-2 py-2 text-center">
                      <p className="text-[19px] font-black tabular-nums" style={{ color: c }}>{v}</p>
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
                    </div>
                  ))}
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                  <ShieldCheck className="h-3 w-3 text-emerald-600" />
                  DOL + USCIS public records
                </span>
                <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
                  Real petition history, not a guess. You know they file before you apply.
                </p>
              </div>

              <div className="hidden items-center md:flex" aria-hidden>
                <ArrowRight className="h-5 w-5 text-slate-300" />
              </div>

              {/* Step 3: applied with confidence */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">3 · Applied with confidence</p>
                <div className="mt-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  </span>
                  <div>
                    <p className="text-[13.5px] font-semibold text-slate-900">Application sent</p>
                    <p className="text-[11.5px] text-slate-400">Tailored resume + cover letter attached</p>
                  </div>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#FF5C18]/10 px-2.5 py-1 text-[11px] font-bold text-[#FF5C18]">
                  <Zap className="h-3 w-3" />
                  You&apos;re applicant #4, not #2,401
                </span>
                <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
                  Apex autofills the form. You review and hit send while the role is still hot.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats + Logo wall ────────────────────────────────────────────── */}
      <section className="border-b border-slate-100 bg-slate-50/60 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 grid grid-cols-2 gap-6">
            {[
              { value: stats.jobs > 0 ? stats.jobs.toLocaleString() : "10K+", label: "active jobs" },
              { value: "Real-time", label: "feed updates" },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{value}</p>
                <p className="mt-1 text-[12px] text-slate-400">{label}</p>
              </div>
            ))}
          </div>
          <p className="mb-8 text-center text-[10.5px] font-bold uppercase tracking-widest text-slate-400">
            Tracking jobs at
          </p>
          {featured.length > 0 ? (
            <LogoWall companies={featured} />
          ) : (
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2">
              {["Stripe", "Meta", "Google", "Anthropic", "OpenAI", "Figma", "Databricks"].map((n) => (
                <span key={n} className="text-sm font-medium text-slate-400">{n}</span>
              ))}
            </div>
          )}
          <p className="mt-6 text-center text-xs text-slate-400">
            …and thousands more across Greenhouse, Lever, Ashby, Workday, Workable, iCIMS, SmartRecruiters, Jobvite, SuccessFactors, and more.
          </p>
        </div>
      </section>

      {/* ── Extension + H-1B data cards ─────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-white px-6 py-14">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">

          {/* Chrome extension */}
          <Link
            href="/extension"
            className="group relative overflow-hidden rounded-[28px] p-8 ring-1 ring-white/10 transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_80px_-20px_rgba(255,92,24,0.5)]"
            style={{ background: "linear-gradient(145deg,#131029 0%,#1d1230 55%,#2a1220 100%)" }}
          >
            <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#FF5C18]/25 blur-[80px] transition duration-500 group-hover:bg-[#FF5C18]/40" />
            <span aria-hidden className="pointer-events-none absolute inset-0 opacity-40"
              style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />

            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#FF5C18]/15 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#FF9A3C] ring-1 ring-[#FF5C18]/30">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF9A3C] opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#FF9A3C]" />
                </span>
                New · Chrome Web Store
              </span>

              <h3 className="mt-5 text-[26px] font-black leading-tight tracking-tight text-white">
                Autofill any application{" "}
                <span style={{ background: "linear-gradient(90deg,#FF5C18,#FF9A3C,#FFD280)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  in one click.
                </span>
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/55">
                Match scores and autofill on LinkedIn plus Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, and BambooHR. Free.
              </p>

              {/* Mini autofill visual */}
              <div className="mt-6 space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm">
                {[["FULL NAME", "Felix S."], ["WORK AUTHORIZATION", "Filled from profile"], ["RESUME", "Tailored + attached"]].map(([l, v]) => (
                  <div key={l} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                    <div>
                      <p className="text-[8.5px] font-bold tracking-wider text-white/35">{l}</p>
                      <p className="text-[12px] font-semibold text-white/85">{v}</p>
                    </div>
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-400/20">
                      <Check className="h-3 w-3 text-emerald-400" strokeWidth={3.5} />
                    </span>
                  </div>
                ))}
              </div>

              <span className="mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-bold text-white shadow-[0_8px_24px_rgba(255,92,24,0.4)] transition group-hover:brightness-110"
                style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}>
                Get the extension
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </span>
            </div>
          </Link>

          {/* H-1B sponsor leaderboard */}
          <Link
            href="/h1b-sponsors/leaderboard"
            className="group relative overflow-hidden rounded-[28px] p-8 ring-1 ring-white/10 transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_80px_-20px_rgba(16,185,129,0.5)]"
            style={{ background: "linear-gradient(145deg,#07231c 0%,#0b3527 55%,#0a2e40 100%)" }}
          >
            <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/25 blur-[80px] transition duration-500 group-hover:bg-emerald-500/40" />
            <span aria-hidden className="pointer-events-none absolute inset-0 opacity-40"
              style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />

            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-emerald-300 ring-1 ring-emerald-500/30">
                <ShieldCheck className="h-3 w-3" />
                Free public data · No signup
              </span>

              <h3 className="mt-5 text-[26px] font-black leading-tight tracking-tight text-white">
                {stats.jobs > 0 ? `${stats.jobs.toLocaleString()} jobs,` : "Every job,"}{" "}
                <span style={{ background: "linear-gradient(90deg,#34d399,#6ee7b7,#a7f3d0)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  sponsorship-ranked.
                </span>
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/55">
                See who actually files: petition history from DOL and USCIS public records.
              </p>

              {/* Mini leaderboard visual */}
              <div className="mt-6 space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm">
                {[["1", "Amazon", "w-[92%]", "9,265"], ["2", "Google", "w-[74%]", "5,842"], ["3", "Microsoft", "w-[61%]", "4,725"]].map(([r, co, w, n]) => (
                  <div key={co} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                    <span className="w-3 text-[11px] font-black text-emerald-300">{r}</span>
                    <span className="w-20 truncate text-[12px] font-semibold text-white/85">{co}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span className={`block h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 ${w}`} />
                    </span>
                    <span className="text-[11px] font-bold tabular-nums text-white/60">{n}</span>
                  </div>
                ))}
              </div>

              <span className="mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.4)] transition group-hover:brightness-110"
                style={{ background: "linear-gradient(135deg,#10b981,#34d399)" }}>
                View the leaderboard
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        </div>
      </section>

      {/* ── Core features ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 py-24"
        style={{ background: "linear-gradient(160deg,#FFF8F4 0%,#F9F8FF 45%,#F4F8FF 100%)" }}>
        {/* Subtle background accents */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-[#FF5C18]/5 blur-[80px]" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-violet-500/5 blur-[60px]" />

        <div className="relative mx-auto max-w-6xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">
              Why people land interviews here
            </p>
            <h2 className="text-3xl font-black tracking-tight text-slate-700 sm:text-4xl">
              Two things decide your search:
              <span className="block" style={{ background: "linear-gradient(90deg,#FF5C18,#FF9A3C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                speed and certainty.
              </span>
            </h2>
          </div>

          {/* Two core benefits, weighted */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="relative overflow-hidden rounded-3xl border border-[#FFE0CC] bg-white p-8 shadow-[0_4px_28px_rgba(255,92,24,0.10)]">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">Speed</p>
              <h3 className="mt-2 text-[22px] font-black tracking-tight text-slate-900">
                Be applicant #4, not #2,401.
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-slate-500">
                We watch companies&apos; own career pages, so roles hit your feed minutes after they
                post. The first applicants get read. Hireoven puts you in that group, every time.
              </p>
              {/* Mini visual */}
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white"
                  style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}>
                  S
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-slate-800">Senior Frontend Engineer</p>
                  <p className="text-[11px] text-slate-400">Stripe · Remote</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10.5px] font-bold text-emerald-700">2m ago</span>
                <span className="rounded-lg px-3 py-1.5 text-[11.5px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}>
                  Apply
                </span>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-3xl border border-[#D8E8FF] bg-white p-8 shadow-[0_4px_28px_rgba(37,99,235,0.09)]">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#2563EB]">Certainty</p>
              <h3 className="mt-2 text-[22px] font-black tracking-tight text-slate-900">
                Never waste an application on a non-sponsor.
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-slate-500">
                Petition history from DOL and USCIS public records sits on every listing: who files,
                how often, and how it ends. The final-round surprise, moved to minute one.
              </p>
              {/* Mini visual */}
              <div className="mt-6 grid grid-cols-3 gap-2.5">
                {[["Sponsor score", "89", "#FF5C18"], ["H-1B petitions", "412", "#7C3AED"], ["Approval rate", "81%", "#059669"]].map(([l, v, c]) => (
                  <div key={l} className="rounded-xl border border-slate-100 bg-slate-50/70 px-2 py-3 text-center">
                    <p className="text-[22px] font-black tabular-nums" style={{ color: c }}>{v}</p>
                    <p className="mt-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Everything else, compact */}
          <div className="mt-14">
            <p className="mb-6 text-center text-[13px] font-bold text-slate-400">
              And the rest of the kitchen, built in:
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard icon="🤖" title="Apply in one click" body="The extension autofills any career page from your profile. You review, then send." accent="Chrome extension" color="#0EA5E9" />
              <FeatureCard icon="✍️" title="Resume + cover letter, per job" body="Apex tailors both to the posting. Keyword gaps flagged, every edit approved by you." color="#10B981" />
              <FeatureCard icon="🛡️" title="Ghost job detector" body="Skip listings that are just collecting CVs. We flag them before you spend time." color="#EF4444" />
              <FeatureCard icon="🎯" title="AI match scores" body="Every job scored against your profile, so you spend effort only where you can win." color="#7C3AED" />
              <FeatureCard icon="👥" title="Cohorts" body="See how people with your background are landing interviews, and adjust weekly." color="#F59E0B" />
              <FeatureCard icon="🇺🇸🇨🇦" title="US + Canada only" body="Every role is North American. No overseas noise to filter out." accent="Fair Chance friendly" color="#2563EB" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Apex AI ────────────────────────────────────────────────────── */}
      <section className="overflow-hidden px-6 py-24"
        style={{ background: "linear-gradient(150deg,#0f0a1e 0%,#1c0e00 50%,#080614 100%)" }}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 flex items-center justify-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg"
              style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}>
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </span>
            <span className="text-xs font-bold uppercase tracking-[0.25em] text-[#FF9A3C]">Apex AI</span>
          </div>
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">
            Your AI job search operating system.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-lg text-white/55">
            Ask Apex anything. It handles the research, tailoring, and workflows — you make the calls.
          </p>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { emoji: "🔍", title: "Finds stronger opportunities", body: "Filters by sponsorship, match score, remote, and more. No manual digging." },
              { emoji: "🏢", title: "Researches companies", body: "H-1B history, hiring velocity, and market signals — evidence-backed answers." },
              { emoji: "📋", title: "Application workflows", body: "Tailor → cover letter → autofill — step by step, with your sign-off at each stage." },
              { emoji: "🤖", title: "Autofills with context", body: "Detects fields, suggests values from your profile, waits for your review." },
              { emoji: "🎤", title: "Interview prep", body: "Role-specific questions with AI feedback on your answers before the real thing." },
              { emoji: "🛡️", title: "Always in control", body: "Apex never submits. Every sensitive action requires your explicit OK." },
            ].map(({ emoji, title, body }) => (
              <div key={title}
                className="rounded-2xl border border-white/8 bg-white/5 p-5 backdrop-blur-sm transition hover:border-[#FF5C18]/30 hover:bg-white/8">
                <span className="text-2xl" aria-hidden>{emoji}</span>
                <p className="mt-3 text-[14px] font-bold text-white">{title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/signup"
              className="inline-flex items-center gap-2 rounded-2xl px-7 py-3.5 text-sm font-bold text-white transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}>
              Try Apex free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-xs text-white/30">Pro feature · Paid plans start at $19/month</p>
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">How it works</p>
            <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Set it up once. Land interviews on autopilot.
            </h2>
          </div>
          <div className="relative grid gap-6 md:grid-cols-3">
            {/* Connector line */}
            <div className="absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-transparent via-[#FF5C18]/30 to-transparent md:block" />
            {[
              { n: "01", title: "Build your profile in 2 minutes", body: "Upload your resume, pick target roles, set your location and visa status. Done." },
              { n: "02", title: "Your feed goes live instantly", body: "Matching roles stream in — ranked by fit, freshness, and sponsorship odds." },
              { n: "03", title: "Apply with one click", body: "Autofill pre-fills the form. Tailored cover letter ready. You hit send while the role is still hot." },
            ].map(({ n, title, body }) => (
              <div key={n} className="relative rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-black text-white"
                  style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}>
                  {n}
                </div>
                <h3 className="mb-2 text-[15px] font-bold text-slate-900">{title}</h3>
                <p className="text-[13px] leading-relaxed text-slate-500">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing preview ─────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50/50 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">Simple pricing</p>
            <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Start free. Upgrade when you&apos;re ready.
            </h2>
            <p className="mt-4 text-lg text-slate-500">
              All plans include the real-time job feed. No bait-and-switch.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <PlanCard
              name="Free"
              price="Free"
              note="Forever"
              features={["Real-time job feed", "AI match scores", "Watchlist & alerts", "Application tracker", "Basic autofill"]}
            />
            <PlanCard
              name="Pro"
              price="$19"
              note="per month · $149/yr"
              badge="Most popular"
              highlight
              features={["Apex AI — 30 msg/day", "Resume tailoring", "Cover letter generator", "Deep analysis", "Interview prep", "Unlimited watchlist"]}
            />
            <PlanCard
              name="Max"
              price="$29"
              note="per month · $229/yr"
              features={["Apex AI — 60 msg/day", "Live voice interviews", "Unlimited AI tools", "Apex strategy insights", "Everything in Pro"]}
            />
          </div>
          <p className="mt-8 text-center text-sm text-slate-400">
            Paid plans start at $19/month. Cancel anytime.{" "}
            <Link href="/pricing" className="font-semibold text-[#FF5C18] hover:underline">Full comparison →</Link>
          </p>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="px-6 py-24"
        style={{ background: "linear-gradient(150deg,#0f0a1e 0%,#1a0800 50%,#080614 100%)" }}>
        <div className="pointer-events-none absolute left-1/4 h-80 w-80 -translate-y-1/2 rounded-full bg-[#FF5C18]/8 blur-[100px]" />
        <div className="relative mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)", boxShadow: "0 8px 30px rgba(255,92,24,0.4)" }}>
            <Zap className="h-7 w-7 text-white" strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
            Stop finding out about jobs days late.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/55">
            The first 10 applicants get the most attention. Hireoven makes sure you&apos;re one of them.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/signup"
              className="inline-flex items-center gap-2 rounded-2xl px-9 py-4 text-base font-bold text-white shadow-[0_8px_30px_rgba(255,92,24,0.4)] transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}>
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-9 py-4 text-base font-semibold text-white/80 transition hover:bg-white/10">
              See pricing
            </Link>
          </div>
          <p className="mt-5 text-xs text-white/30">Free plan · No credit card · Cancel anytime</p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 bg-white px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 md:grid-cols-[1.4fr,1fr,1fr,1fr,1fr]">
            <div>
              <Link href="/">
                <HireovenLogo variant="full" className="h-10 w-auto max-w-[180px]" />
              </Link>
              <p className="mt-3 max-w-xs text-[13px] text-slate-500 leading-relaxed">
                Fresh jobs, checked for H-1B sponsorship. Built for job seekers who want interviews,
                not just applications.
              </p>
            </div>
            <FooterColumn title="Product" links={[
              { href: "/find", label: "Find jobs" },
              { href: "/jobs/browse", label: "Browse jobs" },
              { href: "/report", label: "Daily report" },
              { href: "/features", label: "Features" },
              { href: "/pricing", label: "Pricing" },
              { href: "/companies", label: "Companies" },
            ]} />
            <FooterColumn title="H-1B Data" links={[
              { href: "/h1b-sponsors/leaderboard", label: "Sponsor Leaderboard" },
              { href: "/h1b-sponsors/leaderboard/by-state/CA", label: "Sponsors in California" },
              { href: "/h1b-sponsors/leaderboard/by-state/NY", label: "Sponsors in New York" },
              { href: "/h1b-sponsors/leaderboard/by-industry/technology", label: "Tech sponsors" },
              { href: "/h1b-sponsors/leaderboard/by-industry/finance", label: "Finance sponsors" },
              { href: "/h1b-sponsors/leaderboard/methodology", label: "Methodology" },
            ]} />
            <FooterColumn title="Account" links={[
              { href: "/login", label: "Sign in" },
              { href: "/signup", label: "Create account" },
            ]} />
            <FooterColumn title="Company" links={[
              { href: "/partners", label: "Partners" },
              { href: "/contact", label: "Contact" },
              { href: "/support", label: "Support" },
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ]} />
          </div>
          <div className="mt-10 border-t border-slate-100 pt-6 flex flex-wrap items-center justify-between gap-y-2">
            <p className="text-[12px] text-slate-400">© {new Date().getFullYear()} Hireoven. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <p className="text-[12px] text-slate-300">Built for people who move fast.</p>
              <Link href="/contact" className="text-[12px] text-slate-400 transition hover:text-slate-900">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
