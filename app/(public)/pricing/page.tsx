"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, CreditCard, Globe, ShieldCheck, Users } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import BillingToggle from "@/components/pricing/BillingToggle"
import PricingCard from "@/components/pricing/PricingCard"
import FeatureRow from "@/components/pricing/FeatureRow"
import TestimonialCard from "@/components/pricing/TestimonialCard"
import { getSignupUrl, type BillingInterval, type PlanKey } from "@/lib/pricing"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "Is the free plan actually free?",
    a: "Yes - always. No credit card, no trial period, no expiration. We believe everyone deserves access to real-time job listings.",
  },
  {
    q: "What happens after the 7-day trial?",
    a: "You'll be charged at your chosen rate unless you cancel before the trial ends. We send a reminder email 24 hours before.",
  },
  {
    q: "Can I switch between monthly and yearly?",
    a: "Yes, anytime from your billing settings. If you switch to yearly mid-month we'll prorate the difference.",
  },
  {
    q: "I'm on OPT - which plan do I need?",
    a: "Pro International is built for you. It includes the OPT countdown, sponsorship scoring, and urgency routing that prioritizes companies with fast H1B processes when your deadline is close.",
  },
  {
    q: "Does Hireoven help with the H1B application itself?",
    a: "We help you find companies that sponsor and understand your odds before you apply. We don't provide immigration legal advice - for that, consult an immigration attorney.",
  },
  {
    q: "What's your refund policy?",
    a: "If you're not satisfied in your first 30 days, email us for a full refund. No questions.",
  },
  {
    q: "Do you offer student discounts?",
    a: "We're working on it. Join our waitlist and we'll notify you when student pricing is available.",
  },
  {
    q: "How do you get job listings so fast?",
    a: "We monitor thousands of company career pages every 30 minutes and detect new postings within minutes. Most jobs appear on Hireoven hours or days before they show up on LinkedIn or Indeed.",
  },
]

// ─── Comparison table data ────────────────────────────────────────────────────

const COMPARISON_ROWS: Array<{
  feature: string
  free: boolean | string | number
  pro: boolean | string | number
  proIntl: boolean | string | number
  tooltip?: string
  isGroupHeader?: boolean
}> = [
  { feature: "Job discovery", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "Real-time job feed", free: true, pro: true, proIntl: true },
  { feature: "Freshness scores", free: true, pro: true, proIntl: true },
  { feature: "Company watchlist", free: "5 max", pro: "Unlimited", proIntl: "Unlimited" },
  { feature: "Job alerts", free: "3 max", pro: "Unlimited", proIntl: "Unlimited" },
  { feature: "Match scores on feed", free: false, pro: true, proIntl: true, tooltip: "AI-powered match score based on your resume and preferences" },
  { feature: "Priority sponsor alerts", free: false, pro: false, proIntl: true, tooltip: "Get notified first when a high-sponsorship company posts a role" },

  { feature: "Resume tools", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "Resume upload", free: false, pro: true, proIntl: true },
  { feature: "AI parsing", free: false, pro: true, proIntl: true },
  { feature: "Gap analysis", free: false, pro: "20/mo", proIntl: "Unlimited" },
  { feature: "Resume editor", free: false, pro: true, proIntl: true },
  { feature: "Cover letters", free: false, pro: "10/mo", proIntl: "Unlimited" },
  { feature: "Autofill", free: false, pro: true, proIntl: true, tooltip: "Fill Greenhouse, Lever, and Ashby forms with one click" },

  { feature: "International", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "H1B score badges", free: true, pro: true, proIntl: true },
  { feature: "Company sponsorship profiles", free: false, pro: true, proIntl: true },
  { feature: "H1B petition history (3yr)", free: false, pro: false, proIntl: true },
  { feature: "Sponsorship likelihood score", free: false, pro: false, proIntl: true },
  { feature: "OPT countdown", free: false, pro: true, proIntl: true },
  { feature: "OPT urgency routing", free: false, pro: false, proIntl: true, tooltip: "Jobs sorted by sponsorship speed when your OPT deadline is close" },
  { feature: "Visa language detection", free: false, pro: false, proIntl: true },

  { feature: "Applications", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "Basic tracker", free: true, pro: true, proIntl: true },
  { feature: "Full kanban pipeline", free: true, pro: true, proIntl: true },
  { feature: "AI interview prep", free: false, pro: true, proIntl: true },
  { feature: "Offer comparison", free: false, pro: true, proIntl: true },
]

// ─── FAQ accordion item ───────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-200/80 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left transition hover:text-[#0369A1]"
      >
        <span className="text-[15px] font-semibold text-slate-900">{q}</span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className={`overflow-hidden transition-all duration-250 ${open ? "max-h-96 pb-5" : "max-h-0"}`}>
        <p className="text-sm leading-relaxed text-slate-600">{a}</p>
      </div>
    </div>
  )
}

// ─── Trust signals ────────────────────────────────────────────────────────────

const TRUST_SIGNALS = [
  { icon: ShieldCheck, text: "7-day free trial - no credit card required" },
  { icon: Globe, text: "Cancel anytime - no questions asked" },
  { icon: CreditCard, text: "Secure billing via Stripe" },
  { icon: Users, text: "Used by students at 200+ universities" },
]

// ─── Testimonials ─────────────────────────────────────────────────────────────

// TODO: replace with real testimonials
const TESTIMONIALS = [
  {
    quote: "I applied to a job 12 minutes after it was posted. Got an interview. The match scores stopped me from wasting time on roles I had no shot at.",
    name: "Sarah K.",
    role: "Software Engineer",
  },
  {
    quote: "The sponsorship scores saved me hours of research. I stopped applying to companies that would never sponsor and focused on the ones that actually would. Got sponsored within 3 months.",
    name: "Ravi M.",
    role: "Data Scientist - OPT",
  },
  {
    quote: "The cover letter generator wrote better letters than I could in a fraction of the time. I used it for every application during my search.",
    name: "Jessica L.",
    role: "Product Manager",
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [interval, setInterval] = useState<BillingInterval>("monthly")
  const { user } = useAuth()
  const { plan: currentPlan } = useSubscription()

  async function handleUpgrade(plan: PlanKey, bil: BillingInterval) {
    if (!user) {
      window.location.href = getSignupUrl(plan, bil)
      return
    }

    if (plan === "free") return

    const response = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval: bil }),
    })
    const data = await response.json().catch(() => ({}))
    if (data.url) window.location.href = data.url
  }

  return (
    <div className="min-h-dvh">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="px-6 pt-20 pb-14 text-center bg-[radial-gradient(ellipse_at_top,_rgba(3,105,161,0.07),_transparent_55%)]">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#0369A1] mb-4">Pricing</p>
        <h1 className="text-[2.75rem] font-bold leading-[1.15] tracking-tight text-slate-950 mx-auto max-w-2xl">
          Land your next job faster
        </h1>
        <p className="mt-4 text-lg text-slate-500 mx-auto max-w-xl leading-relaxed">
          Real-time jobs, AI resume tools, and H1B sponsorship intel - everything you need in one place
        </p>

        <div className="mt-10">
          <BillingToggle value={interval} onChange={setInterval} />
        </div>
      </section>

      {/* ── Pricing cards ─────────────────────────────────────── */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-3">
          {(["free", "pro", "pro_international"] as PlanKey[]).map((plan) => (
            <PricingCard
              key={plan}
              plan={plan}
              interval={interval}
              isCurrentPlan={currentPlan === plan || (plan === "free" && currentPlan === "free")}
              onUpgrade={handleUpgrade}
              isLoggedIn={Boolean(user)}
              userPlan={currentPlan}
            />
          ))}
        </div>
      </section>

      {/* ── Trust signals ─────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50/60 px-6 py-10">
        <div className="mx-auto max-w-5xl grid grid-cols-2 gap-6 md:grid-cols-4">
          {TRUST_SIGNALS.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#0369A1]/10">
                <Icon className="h-4 w-4 text-[#0369A1]" />
              </div>
              <p className="text-sm font-medium text-slate-700">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ──────────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="section-kicker text-center mb-3">What people say</p>
          <h2 className="text-center text-2xl font-bold text-slate-950 mb-10">
            Join thousands already applying first
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <TestimonialCard key={t.name} {...t} />
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section className="border-t border-slate-100 px-6 py-20 bg-slate-50/40">
        <div className="mx-auto max-w-2xl">
          <p className="section-kicker text-center mb-3">FAQ</p>
          <h2 className="text-center text-2xl font-bold text-slate-950 mb-10">
            Common questions
          </h2>
          <div className="rounded-[20px] border border-slate-200/80 bg-white px-6">
            {FAQ_ITEMS.map((item) => (
              <FaqItem key={item.q} {...item} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison table ──────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="section-kicker text-center mb-3">Full comparison</p>
          <h2 className="text-center text-2xl font-bold text-slate-950 mb-10">
            Every feature, side by side
          </h2>
          <div className="rounded-[20px] border border-slate-200/80 bg-white overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-4 text-left text-sm font-semibold text-slate-700 w-1/2">Feature</th>
                  <th className="px-4 py-4 text-center text-sm font-semibold text-slate-700">Free</th>
                  <th className="px-4 py-4 text-center text-sm font-semibold text-[#0369A1] bg-[#F0FDFA]/60">Pro</th>
                  <th className="px-4 py-4 text-center text-sm font-semibold text-[#1D4ED8]">Pro Intl.</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <FeatureRow key={i} {...row} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ────────────────────────────────────────── */}
      <section className="px-6 py-24 bg-[radial-gradient(ellipse_at_center,_rgba(3,105,161,0.07),_transparent_65%)] border-t border-slate-100">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-950">
            Start finding jobs the moment they post
          </h2>
          <p className="mt-3 text-lg text-slate-500">
            Join thousands of job seekers who apply before the crowd
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              Get started free
            </Link>
            <Link
              href="/signup?plan=pro&interval=monthly"
              className="rounded-xl bg-[#0369A1] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(3,105,161,0.28)] transition hover:bg-[#075985]"
            >
              Start Pro trial
            </Link>
          </div>
        </div>
      </section>

      {/* Minimal footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-8 text-center">
        <p className="text-sm text-slate-400">
          © {new Date().getFullYear()} Hireoven ·{" "}
          <Link href="/terms" className="hover:text-slate-600">Terms</Link>
          {" · "}
          <Link href="/privacy" className="hover:text-slate-600">Privacy</Link>
        </p>
      </footer>
    </div>
  )
}
