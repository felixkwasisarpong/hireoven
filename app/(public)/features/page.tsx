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

export const metadata: Metadata = {
  title: "Features | Hireoven",
  description:
    "Fresh job feed, AI match scores, per-job intelligence, Apex AI career coach, text/coding/live interview prep, application tracker, and international job-search signals. Everything in one place.",
}

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="border-b border-gray-100 px-6 py-14 md:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0369A1]">{FEATURES_HERO.kicker}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl md:text-[2.75rem]">
            {FEATURES_HERO.title}
          </h1>
          <p className="mt-4 text-lg text-gray-600">{FEATURES_HERO.subtitle}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#0369A1]/20 transition hover:bg-[#075985]"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-7 py-3.5 text-base font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* ── Core: speed + apply ───────────────────────────────────── */}
      <section className="px-6 py-16 md:py-20">
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
      <section className="border-y border-slate-100 bg-slate-50/60 px-6 py-16 md:py-20">
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
      <section className="border-b border-[#E0F2FE] bg-[#F0F9FF] px-6 py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="International candidates"
            title="International &amp; offer intelligence"
            body="Layered on the same job feed when you need it. Search and prioritisation tools. Verify anything binding with your DSO or immigration counsel."
            kickerColor="text-[#0369A1]"
          />
          <InternationalFeaturesTable items={INTERNATIONAL_HIGHLIGHTS} />
        </div>
      </section>

      {/* ── Apex AI ──────────────────────────────────────────────── */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="Apex AI"
            title="Your AI career coach"
            body="Not just a chatbot. Apex reads your resume, knows the job market, and gives you a concrete plan: which roles to target, which gaps to close, which bullets to rewrite."
            kickerColor="text-indigo-600"
          />
          <CoreFeaturesTable features={APEX_FEATURES} />
        </div>
      </section>

      {/* ── Interview prep ────────────────────────────────────────── */}
      <section className="border-y border-orange-100 bg-orange-50/40 px-6 py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            kicker="Interview prep"
            title="Practice that actually prepares you"
            body="Text, coding, and live voice sessions, each with a probing AI interviewer, hidden tests, and an AI debrief that tells you exactly what to fix before the real thing."
            kickerColor="text-orange-600"
          />
          <CoreFeaturesTable features={INTERVIEW_FEATURES} />
        </div>
      </section>

      {/* ── Application tracker ───────────────────────────────────── */}
      <section className="px-6 py-16 md:py-20">
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
      <section className="border-t border-slate-100 bg-slate-50/40 px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-gray-900">Ready to start?</h2>
          <p className="mt-2 text-gray-500">
            Free plan has no credit card and no expiry. Upgrade when you need more.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#0369A1]/20 transition hover:bg-[#075985]"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-7 py-3.5 text-base font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              Compare plans
            </Link>
          </div>
          <p className="mt-8 text-sm text-gray-400">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-[#0369A1] hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </section>

      <footer className="border-t border-gray-100 bg-white px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-gray-500 sm:flex-row">
          <Link href="/" className="font-semibold text-gray-800 hover:text-[#0369A1]">
            ← Back to home
          </Link>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link href="/companies" className="hover:text-gray-800">Companies</Link>
            <Link href="/pricing" className="hover:text-gray-800">Pricing</Link>
            <Link href="/terms" className="hover:text-gray-800">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function SectionHeader({
  kicker,
  title,
  body,
  kickerColor = "text-slate-500",
}: {
  kicker: string
  title: string
  body: string
  kickerColor?: string
}) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className={`mb-1.5 text-xs font-bold uppercase tracking-widest ${kickerColor}`}>{kicker}</p>
      <h2
        className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl"
        dangerouslySetInnerHTML={{ __html: title }}
      />
      <p className="mt-2 text-gray-600">{body}</p>
    </div>
  )
}
