import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, CheckCircle2, Globe2, ShieldCheck, Sparkles, Users, Zap } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import LogoWall from "@/components/marketing/LogoWall"
import { WaitlistInlineForm } from "@/components/marketing/WaitlistInlineForm"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import HireovenLogo from "@/components/ui/HireovenLogo"
import MaintenanceBanner from "@/components/marketing/MaintenanceBanner"

export const metadata: Metadata = {
  title: "Hireoven — Jobs served fresh. Be an early bird applicant.",
  description:
    "Real-time job alerts, AI match scores, one-click apply, and Apex AI for your entire job search. Built for people who want interviews, not just applications.",
}

export const dynamic = "force-dynamic"

// ── Data ─────────────────────────────────────────────────────────────────────

async function getPlatformStats() {
  if (!hasPostgresEnv()) return { jobs: 0, companies: 0 }
  try {
    const pool = getPostgresPool()
    const [jobs, companies] = await Promise.all([
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM jobs WHERE is_active = true AND ${sqlJobLocatedInUsa("jobs")}`),
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
        href="/launch"
        className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-bold text-white transition"
        style={{
          background: highlight
            ? "linear-gradient(135deg,#FF5C18,#FF7A35)"
            : "linear-gradient(135deg,#7C3AED,#C026D3)",
        }}
      >
        Join the waitlist
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-white">
      <MaintenanceBanner />
      <Navbar />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden"
        style={{ background: "linear-gradient(150deg, #0f0a1e 0%, #1a0800 40%, #0d1220 75%, #080614 100%)" }}>

        {/* Ambient glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-[#FF5C18]/12 blur-[120px]" />
          <div className="absolute right-0 top-1/4 h-[400px] w-[400px] rounded-full bg-violet-600/10 blur-[100px]" />
          <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-[#FF9A3C]/8 blur-[80px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-20 md:pb-32 md:pt-28">
          <div className="mx-auto max-w-3xl text-center">

            {/* Live badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/70 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live · {stats.jobs > 0 ? stats.jobs.toLocaleString() : "10,000+"} jobs tracked right now
            </div>

            <h1 className="text-[2.8rem] font-black leading-[1.04] tracking-tight text-white sm:text-5xl md:text-[3.75rem]">
              Your next job,{" "}
              <span style={{ background: "linear-gradient(90deg,#FF5C18,#FF9A3C,#FFD280)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                found first.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/60 md:text-xl">
              Real-time alerts the moment a role posts. AI match scores on every listing. One-click autofill.
              Apex AI that researches, tailors, and prepares — while you stay in control.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/launch"
                className="inline-flex items-center gap-2 rounded-2xl px-8 py-4 text-base font-bold text-white shadow-[0_8px_30px_rgba(255,92,24,0.4)] transition hover:brightness-110"
                style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}>
                Join the waitlist
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-base font-semibold text-white/80 backdrop-blur-sm transition hover:bg-white/10">
                See pricing
              </Link>
            </div>

            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {["Early access", "No credit card", "Invite sent when approved"].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5 text-sm text-white/45">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Mock product preview */}
          <div className="mx-auto mt-16 max-w-2xl">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md">
              {/* Toolbar */}
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
                </div>
                <p className="text-[11px] font-medium text-white/30">hireoven.com/dashboard</p>
                <div className="w-16" />
              </div>
              {/* Job cards */}
              <div className="space-y-2 p-4">
                {[
                  { co: "Stripe", role: "Senior Frontend Engineer", loc: "Remote · SF", match: 94, sponsor: 89, fresh: "2m" },
                  { co: "Anthropic", role: "ML Platform Engineer", loc: "San Francisco, CA", match: 88, sponsor: 95, fresh: "8m" },
                  { co: "Figma", role: "Staff Software Engineer", loc: "Remote · NYC", match: 81, sponsor: 72, fresh: "14m" },
                ].map((job, i) => (
                  <div key={i} className={["rounded-xl border p-3.5 transition", i === 0 ? "border-[#FF5C18]/40 bg-white/8" : "border-white/8 bg-white/4"].join(" ")}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white"
                        style={{ background: i === 0 ? "linear-gradient(135deg,#FF5C18,#FF9A3C)" : "rgba(255,255,255,0.1)" }}>
                        {job.co[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-white">{job.role}</p>
                        <p className="text-[11px] text-white/45">{job.co} · {job.loc}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          {job.fresh} ago
                        </span>
                        {i === 0 && (
                          <span className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-white"
                            style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}>
                            Apply
                          </span>
                        )}
                      </div>
                    </div>
                    {i === 0 && (
                      <div className="mt-2.5 grid grid-cols-3 gap-2">
                        {[["Match", job.match, "#FF5C18"], ["Sponsor", job.sponsor, "#7C3AED"], ["Approval", 81, "#10B981"]].map(([l, v, c]) => (
                          <div key={String(l)} className="rounded-lg bg-white/5 px-2 py-1.5 text-center">
                            <p className="text-[18px] font-black tabular-nums" style={{ color: String(c) }}>{v}</p>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-white/35">{l}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats + Logo wall ────────────────────────────────────────────── */}
      <section className="border-b border-slate-100 bg-slate-50/60 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 grid grid-cols-3 gap-6">
            {[
              { value: stats.jobs > 0 ? stats.jobs.toLocaleString() : "10K+", label: "active jobs" },
              { value: "<30min", label: "avg. detection time" },
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
            …and thousands more across Greenhouse, Lever, Ashby, and Workday.
          </p>
        </div>
      </section>

      {/* ── Chrome extension launch ribbon ─────────────────────────────── */}
      <section className="border-y border-slate-100 bg-white px-6 py-8">
        <Link
          href="/extension"
          className="group mx-auto flex max-w-5xl flex-col items-center gap-3 rounded-3xl border border-slate-200/70 bg-gradient-to-br from-[#0C0A1E] via-[#16102e] to-[#1a0a2e] p-6 transition hover:border-[#FF5C18]/40 sm:flex-row sm:gap-5 sm:p-5"
        >
          <span
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg"
            style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}
            aria-hidden
          >
            🧩
          </span>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#FF9A3C]">
              New · now on the Chrome Web Store
            </p>
            <p className="mt-1 text-[15px] font-semibold text-white">
              Match score + autofill on every job posting — free Chrome extension.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-slate-900 transition group-hover:bg-[#FF5C18] group-hover:text-white">
            Get the extension
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
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
              Everything in one place
            </p>
            <h2 className="text-3xl font-black tracking-tight text-slate-700 sm:text-4xl">
              From posted to applied —
              <span className="block" style={{ background: "linear-gradient(90deg,#FF5C18,#FF9A3C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                in the time it takes to pour a coffee.
              </span>
            </h2>
            <p className="mt-4 text-lg text-slate-500">
              No spreadsheets, no 12 browser tabs. Hireoven replaces the duct-taped stack.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard icon="⚡" title="Real-time job feed" body="New roles appear within minutes of posting — before most job boards index them." accent="No sponsored listings" color="#FF5C18" />
            <FeatureCard icon="🎯" title="AI match scores" body="Every job gets a match score against your profile, skills, and target role. Algorithmic, instant." color="#7C3AED" />
            <FeatureCard icon="🤖" title="One-click autofill" body="The extension detects fields and pre-fills them from your profile. You review before it goes in." accent="Chrome extension" color="#0EA5E9" />
            <FeatureCard icon="✍️" title="Resume tailoring" body="Apex adapts your CV to the job description. Keyword gaps flagged. Every edit needs your approval." color="#10B981" />
            <FeatureCard icon="📄" title="Cover letter AI" body="Generates a tailored, ATS-aware letter in seconds. Role-specific, honest, ready to personalise." color="#F59E0B" />
            <FeatureCard icon="🛡️" title="Ghost job detector" body="Signals whether a role is actively hiring or just collecting CVs — before you spend time on it." color="#EF4444" />
          </div>
        </div>
      </section>

      {/* ── Differentiators ────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-white px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">
              Why Hireoven
            </p>
            <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Differentiators built into the core flow
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[#D8E8FF] bg-[#F5FAFF] p-5 shadow-[0_2px_12px_rgba(37,99,235,0.08)]">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#2563EB]">
                <Globe2 className="h-4.5 w-4.5" />
              </div>
              <p className="mt-3 text-[15px] font-bold text-slate-900">H-1B Intel</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                Petition history, sponsorship likelihood, and visa-language signals on each matching role.
              </p>
            </div>
            <div className="rounded-2xl border border-[#E8DBFF] bg-[#FAF7FF] p-5 shadow-[0_2px_12px_rgba(124,58,237,0.09)]">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#7C3AED]">
                <Users className="h-4.5 w-4.5" />
              </div>
              <p className="mt-3 text-[15px] font-bold text-slate-900">Cohorts</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                See how people with similar background are performing and adjust your weekly job search strategy.
              </p>
            </div>
            <div className="rounded-2xl border border-[#D7F2E2] bg-[#F3FBF6] p-5 shadow-[0_2px_12px_rgba(4,120,87,0.09)]">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#047857]">
                <ShieldCheck className="h-4.5 w-4.5" />
              </div>
              <p className="mt-3 text-[15px] font-bold text-slate-900">Fair Chance</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                Find fair-chance friendly employers and get preparation guidance before you apply.
              </p>
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
            <Link href="/launch"
              className="inline-flex items-center gap-2 rounded-2xl px-7 py-3.5 text-sm font-bold text-white transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}>
              Join the waitlist
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-xs text-white/30">Pro feature · 7-day free trial included</p>
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
            All paid plans include a 7-day free trial. Cancel anytime.{" "}
            <Link href="/pricing" className="font-semibold text-[#FF5C18] hover:underline">Full comparison →</Link>
          </p>
        </div>
      </section>

      {/* ── Waitlist section ────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#FF5C18]/25 bg-[#FF5C18]/8 px-4 py-1.5 text-[12px] font-bold uppercase tracking-widest text-[#FF5C18]">
            <Users className="h-3.5 w-3.5" />
            Early access · Waitlist open
          </div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Get in before the doors open.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg text-slate-500">
            Hireoven is currently invite-only. Join the waitlist and we&apos;ll send you an invite link as soon as your spot is ready — no spam, no waiting in the dark.
          </p>

          {/* Inline email form */}
          <WaitlistInlineForm />

          <p className="mt-4 text-xs text-slate-400">
            We review every application. You&apos;ll hear back within 24–48 hours.
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
            <Link href="/launch"
              className="inline-flex items-center gap-2 rounded-2xl px-9 py-4 text-base font-bold text-white shadow-[0_8px_30px_rgba(255,92,24,0.4)] transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}>
              Join the waitlist
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-9 py-4 text-base font-semibold text-white/80 transition hover:bg-white/10">
              See pricing
            </Link>
          </div>
          <p className="mt-5 text-xs text-white/30">No credit card · Invite sent when approved · Early access</p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 bg-white px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 md:grid-cols-[1.4fr,1fr,1fr,1fr]">
            <div>
              <Link href="/">
                <HireovenLogo variant="full" className="h-10 w-auto max-w-[180px]" />
              </Link>
              <p className="mt-3 max-w-xs text-[13px] text-slate-500 leading-relaxed">
                Jobs served fresh. Built for job seekers who want interviews, not just applications.
              </p>
            </div>
            <FooterColumn title="Product" links={[
              { href: "/features", label: "Features" },
              { href: "/pricing", label: "Pricing" },
              { href: "/companies", label: "Companies" },
            ]} />
            <FooterColumn title="Account" links={[
              { href: "/login", label: "Sign in" },
              { href: "/launch", label: "Join waitlist" },
            ]} />
            <FooterColumn title="Legal" links={[
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ]} />
          </div>
          <div className="mt-10 border-t border-slate-100 pt-6 flex flex-wrap items-center justify-between gap-y-2">
            <p className="text-[12px] text-slate-400">© {new Date().getFullYear()} Hireoven. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <p className="text-[12px] text-slate-300">Built for people who move fast.</p>
              <p className="text-[12px] text-slate-400">Powered by Sepurux</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
