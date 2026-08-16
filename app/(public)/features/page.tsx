import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import {
  CoreFeaturesTable,
  InternationalFeaturesTable,
} from "@/components/marketing/MarketingFeatureBlocks"
import {
  CORE_FEATURES,
  FEATURES_HERO,
  INTERNATIONAL_HIGHLIGHTS,
  INTERVIEW_FEATURES,
  JOB_INTEL_FEATURES,
  APEX_FEATURES,
  TRACKER_FEATURES,
} from "@/lib/marketing/product-features"

const FEATURE_STATS = [
  ["30 min", "career-page sweep"],
  ["7 ATS", "autofill-native systems"],
  ["1 view", "job, resume, visa evidence"],
] as const

export const metadata: Metadata = {
  title: "Features | Hireoven",
  description:
    "Fresh job feed, AI match scores, per-job intelligence, Apex AI career coach, text/coding/live interview prep, application tracker, and international job-search signals. Everything in one place.",
}

export default function FeaturesPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="mx-auto grid w-full max-w-[78rem] items-end gap-8 px-4 pt-12 sm:px-6 md:grid-cols-[minmax(0,0.95fr)_minmax(22rem,0.78fr)] lg:px-10">
        <div>
          <p className="term-label">{FEATURES_HERO.kicker}</p>
          <h1 className="mt-4 max-w-[38rem] text-[2.4rem] font-semibold leading-[1.02] tracking-tight text-white sm:text-[3.4rem]">
            {FEATURES_HERO.title}
          </h1>
          <p className="mt-4 max-w-[36rem] text-[14px] leading-relaxed text-[#ccd6cf]/70">{FEATURES_HERO.subtitle}</p>
          <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row">
            <Link
              href="/signup?next=%2Fdashboard%2Fonboarding"
              className="term-btn term-btn-amber"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="term-btn">
              See pricing
            </Link>
          </div>
        </div>

        <div className="term-panel p-4">
          <div className="flex items-center justify-between border-b border-[rgba(120,200,160,0.12)] pb-3">
            <p className="term-label">live product map</p>
            <span className="border border-[#f5a623]/30 bg-[#f5a623] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0a0e0c]">Apex</span>
          </div>
          <div className="mt-4 space-y-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)]">
            {[
              ["Career-page radar", "New role detected 7m ago", "fresh"],
              ["Sponsor evidence", "DOL + USCIS history attached", "verified"],
              ["Apply agent", "Resume tailored, waiting for OK", "review"],
            ].map(([title, body, tag]) => (
              <div key={title} className="bg-[#0e1411] p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-semibold text-white">{title}</p>
                  <span className="border border-[#f5a623]/25 bg-[#f5a623]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#f5a623]">{tag}</span>
                </div>
                <p className="mt-1 text-[13px] text-[#ccd6cf]/55">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[rgba(120,200,160,0.12)] pt-4">
            {FEATURE_STATS.map(([value, label]) => (
              <div key={label}>
                <p className="text-2xl font-semibold leading-none tabular-nums text-[#38e08a]">{value}</p>
                <p className="term-label mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Core: speed + apply ───────────────────────────────────── */}
      <section className="px-4 py-16 sm:px-6 md:py-20 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="Job feed"
            title="Move fast on every application"
            body="Everything that keeps you out of spreadsheets and copy-paste loops. One surface, row by row."
          />
          <CoreFeaturesTable features={CORE_FEATURES} />
        </div>
      </section>

      {/* ── Per-job intelligence ───────────────────────────────────── */}
      <section className="border-y border-[rgba(120,200,160,0.2)] px-4 py-16 sm:px-6 md:py-20 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="Per-job signals"
            title="Every listing, intelligently annotated"
            body="Ghost risk, visa fit, salary benchmarks, match breakdown, and company health. All on the card and in the detail panel before you click Apply."
          />
          <CoreFeaturesTable features={JOB_INTEL_FEATURES} />
        </div>
      </section>

      {/* ── International ─────────────────────────────────────────── */}
      <section className="border-b border-[rgba(120,200,160,0.2)] px-4 py-16 sm:px-6 md:py-20 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="International candidates"
            title="International &amp; offer intelligence"
            body="Layered on the same job feed when you need it. Search and prioritisation tools. Verify anything binding with your DSO or immigration counsel."
          />
          <InternationalFeaturesTable items={INTERNATIONAL_HIGHLIGHTS} />
        </div>
      </section>

      {/* ── Apex AI ──────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:px-6 md:py-20 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="Apex AI"
            title="Your AI career coach"
            body="Not just a chatbot. Apex reads your resume, knows the job market, and gives you a concrete plan: which roles to target, which gaps to close, which bullets to rewrite."
          />
          <CoreFeaturesTable features={APEX_FEATURES} />
        </div>
      </section>

      {/* ── Interview prep ────────────────────────────────────────── */}
      <section className="border-y border-[rgba(120,200,160,0.2)] px-4 py-16 sm:px-6 md:py-20 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="Interview prep"
            title="Practice that actually prepares you"
            body="Text, coding, and live voice sessions, each with a probing AI interviewer, hidden tests, and an AI debrief that tells you exactly what to fix before the real thing."
          />
          <CoreFeaturesTable features={INTERVIEW_FEATURES} />
        </div>
      </section>

      {/* ── Application tracker ───────────────────────────────────── */}
      <section className="px-4 py-16 sm:px-6 md:py-20 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="Tracker"
            title="Your whole search, in one pipeline"
            body="Kanban stages, notes, resume version history, and one-click interview practice. All attached to the job card you saved."
          />
          <CoreFeaturesTable features={TRACKER_FEATURES} />
        </div>
      </section>

      {/* ── Footer CTA ────────────────────────────────────────────── */}
      <section className="border-t border-[rgba(120,200,160,0.26)] px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="term-label">{"Ready?"}</p>
          <h2 className="mt-2 text-[2rem] font-semibold leading-[1.05] tracking-tight text-white md:text-[3rem]">
            Ready to <span className="text-[#f5a623]">start?</span>
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/65">
            Free plan has no credit card and no expiry. Upgrade when you need more.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup?next=%2Fdashboard%2Fonboarding"
              className="term-btn term-btn-amber"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="term-btn">
              Compare plans
            </Link>
          </div>
          <p className="mt-8 text-[13px] text-[#ccd6cf]/45">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]">
              Log in
            </Link>
          </p>
        </div>
      </section>

    </div>
  )
}

function SectionHeader({
  kicker,
  title,
  body,
}: {
  kicker: string
  title: string
  body: string
}) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className="term-label mb-2">{kicker}</p>
      <h2
        className="text-[2rem] font-semibold leading-[1.06] tracking-tight text-white sm:text-[2.8rem]"
        dangerouslySetInnerHTML={{ __html: title }}
      />
      <p className="mt-3 text-[15px] leading-7 text-[#ccd6cf]/65">{body}</p>
    </div>
  )
}
