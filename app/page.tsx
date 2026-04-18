import type { Metadata } from "next"
import Link from "next/link"
import { Bell, Clock, Globe, Search, Zap } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import { createAdminClient } from "@/lib/supabase/admin"

export const metadata: Metadata = {
  title: "Hireoven — Jobs served fresh. Apply before the crowd.",
  description:
    "We monitor thousands of company career pages every 30 minutes. See new jobs within minutes of posting. Built for speed, with H1B sponsorship intel for international candidates.",
}

export const revalidate = 3600

const TRUSTED_COMPANIES = [
  "Google", "Meta", "Stripe", "Anthropic", "OpenAI",
  "Microsoft", "Figma", "Databricks", "Airbnb", "Cloudflare",
]

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: Clock,
    title: "We crawl thousands of career pages every 30 minutes",
    body: "Our crawler monitors Greenhouse, Lever, Workday, Ashby, and custom career pages across every major company — day and night.",
  },
  {
    step: "02",
    icon: Zap,
    title: "The moment a job drops, we detect and normalize it",
    body: "Claude AI extracts seniority, skills, sponsorship language, and salary from every listing so you can filter precisely.",
  },
  {
    step: "03",
    icon: Bell,
    title: "You get an instant alert before anyone else applies",
    body: "Email, push notification, or in-app feed — your choice. The first applicants get the most attention. Being early matters.",
  },
]

const INTL_FEATURES = [
  {
    icon: Globe,
    title: "H1B sponsorship scores",
    body: "Every company gets a 0–100 sponsorship confidence score based on USCIS petition history and job description signals.",
  },
  {
    icon: Search,
    title: "Visa language detection",
    body: "We scan every job description for \"must be authorized\", \"no sponsorship\", and positive sponsorship language automatically.",
  },
  {
    icon: Clock,
    title: "OPT countdown tracker",
    body: "See exactly how many days remain on your OPT or STEM OPT. The dashboard keeps urgency visible so you stay focused.",
  },
]

async function getPlatformStats() {
  try {
    const supabase = createAdminClient()
    const [jobs, companies] = await Promise.all([
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("companies").select("*", { count: "exact", head: true }).eq("is_active", true),
    ])
    return { jobs: jobs.count ?? 0, companies: companies.count ?? 0 }
  } catch {
    return { jobs: 0, companies: 0 }
  }
}

export default async function HomePage() {
  const stats = await getPlatformStats()

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* Hero */}
      <section className="px-6 pt-20 pb-24 text-center bg-[radial-gradient(ellipse_at_top,_rgba(3,105,161,0.08),_transparent_60%)]">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#BAE6FD] bg-[#F0F9FF] px-4 py-1.5 text-xs font-semibold text-[#0369A1]">
            <span className="h-2 w-2 rounded-full bg-[#0369A1] animate-pulse" />
            Monitoring {stats.companies.toLocaleString()} companies right now
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 leading-tight mb-5">
            Jobs served fresh.{" "}
            <span className="text-[#0369A1]">Apply before the crowd.</span>
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed mb-8 max-w-2xl mx-auto">
            We monitor thousands of company career pages in real time so you see new
            roles within minutes of posting — with H1B sponsorship intel built in.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="rounded-2xl bg-[#0369A1] px-8 py-3.5 text-base font-semibold text-white hover:bg-[#075985] transition shadow-lg shadow-[#0369A1]/20"
            >
              Get started free →
            </Link>
            <Link
              href="/companies"
              className="rounded-2xl border border-gray-200 bg-white px-8 py-3.5 text-base font-semibold text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition"
            >
              Browse companies
            </Link>
          </div>
        </div>
      </section>

      {/* Social proof / stats */}
      <section className="border-y border-gray-100 bg-gray-50 py-12 px-6">
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-3 gap-8 text-center mb-10">
            {[
              { value: stats.jobs.toLocaleString(), label: "active jobs tracked" },
              { value: stats.companies.toLocaleString(), label: "companies monitored" },
              { value: "<30m", label: "avg. time to detection" },
            ].map(({ value, label }) => (
              <div key={label}>
                <p className="text-3xl font-bold text-[#0369A1]">{value}</p>
                <p className="mt-1 text-sm text-gray-500">{label}</p>
              </div>
            ))}
          </div>
          <p className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-gray-400">
            Jobs tracked at
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-2">
            {TRUSTED_COMPANIES.map((name) => (
              <span key={name} className="text-sm font-medium text-gray-400">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
            How it works
          </p>
          <h2 className="mb-14 text-center text-3xl font-bold text-gray-900">
            Fresh jobs land in your feed in minutes
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {HOW_IT_WORKS.map(({ step, icon: Icon, title, body }) => (
              <div key={step}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-xs font-bold text-[#BAE6FD]">{step}</span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E0F2FE]">
                    <Icon className="h-5 w-5 text-[#0369A1]" />
                  </div>
                </div>
                <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For international candidates */}
      <section className="px-6 py-20 bg-[#F0F9FF] border-y border-[#E0F2FE]">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
              For international candidates
            </p>
            <h2 className="text-3xl font-bold text-gray-900">
              Built for international job seekers
            </h2>
            <p className="mt-4 text-lg text-gray-600 leading-relaxed">
              OPT deadline tracker, H1B sponsorship scores, and visa language detection
              — all built in. Stop wasting applications on companies that won&apos;t sponsor.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-6 py-3 text-sm font-semibold text-white hover:bg-[#075985] transition"
            >
              See which companies sponsor →
            </Link>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {INTL_FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-[#BAE6FD] bg-white p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E0F2FE]">
                  <Icon className="h-5 w-5 text-[#0369A1]" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 py-24 text-center">
        <div className="mx-auto max-w-xl">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Stop finding out about jobs days late
          </h2>
          <p className="text-gray-500 mb-8 leading-relaxed">
            The first 10 applicants get the most attention. Hireoven gets you there first.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-8 py-4 text-base font-semibold text-white hover:bg-[#075985] transition shadow-lg shadow-[#0369A1]/20"
          >
            Sign up free — no credit card
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <p className="text-sm font-semibold text-gray-900">Hireoven</p>
              <p className="mt-1 text-xs text-gray-400">Built for job seekers, not recruiters.</p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500">
              <Link href="/companies" className="hover:text-gray-900 transition">Companies</Link>
              <Link href="/privacy" className="hover:text-gray-900 transition">Privacy</Link>
              <Link href="/terms" className="hover:text-gray-900 transition">Terms</Link>
              <Link href="/login" className="hover:text-gray-900 transition">Login</Link>
              <Link href="/signup" className="hover:text-gray-900 transition">Sign up</Link>
            </nav>
          </div>
          <p className="mt-8 text-xs text-gray-400">
            &copy; {new Date().getFullYear()} Hireoven. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
