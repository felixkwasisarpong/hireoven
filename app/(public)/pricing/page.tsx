"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, CreditCard, Globe, ShieldCheck, Users } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import BillingToggle from "@/components/pricing/BillingToggle"
import PricingCard from "@/components/pricing/PricingCard"
import FeatureRow from "@/components/pricing/FeatureRow"
import TestimonialCard from "@/components/pricing/TestimonialCard"
import {
  PLAN_COMPARISON_ROWS,
  getSignupUrl,
  type BillingInterval,
  type PlanKey,
} from "@/lib/pricing"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { useFeatureFlags } from "@/lib/hooks/useFeatureFlags"

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "Is the free plan actually free?",
    a: "Yes - always. No credit card, no trial period, no expiration. We believe everyone deserves access to real-time job listings.",
  },
  {
    q: "When will I be charged?",
    a: "Paid plans are charged when you check out. You can cancel anytime from billing settings.",
  },
  {
    q: "Can I switch between monthly and yearly?",
    a: "Yes, anytime from your billing settings. If you switch to yearly mid-month we'll prorate the difference.",
  },
  {
    q: "I'm on OPT or H1B. Do I need to pay for international tools?",
    a: "International tools are free for OPT, STEM OPT, and H1B candidates. Just set your visa status during signup. OPT countdown, offer risk analysis, urgency routing, and all sponsorship intelligence unlock automatically. Pro and Pro Max add unlimited AI tools, resume editing, and deep analysis on top.",
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

// ─── FAQ accordion item ───────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-[rgba(120,200,160,0.12)] last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left transition hover:text-[#f5a623]"
      >
        <span className="text-[15px] font-semibold text-white">{q}</span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-[#ccd6cf]/45 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className={`overflow-hidden transition-all duration-250 ${open ? "max-h-96 pb-5" : "max-h-0"}`}>
        <p className="text-sm leading-relaxed text-[#ccd6cf]/65">{a}</p>
      </div>
    </div>
  )
}

// ─── Trust signals ────────────────────────────────────────────────────────────

const TRUST_SIGNALS = [
  { icon: ShieldCheck, text: "Free plan available - no card required" },
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
  const { paymentsDisabled } = useFeatureFlags()

  async function handleUpgrade(plan: PlanKey, bil: BillingInterval) {
    if (paymentsDisabled) return

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
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-3xl px-4 pt-12 text-center sm:px-6">
        <p className="term-label">&gt; pricing --plans</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-[2.4rem] font-semibold leading-[1.02] tracking-tight text-white sm:text-[3.4rem]">
          Land your next job <span className="text-[#f5a623]">faster</span>
          <span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[14px] leading-relaxed text-[#ccd6cf]/70">
          Real-time jobs, AI resume tools, and H1B sponsorship intel - everything you need in one place
        </p>

        <div className="mt-8">
          <BillingToggle value={interval} onChange={setInterval} theme="terminal" />
        </div>
      </section>

      {/* ── Pricing cards ─────────────────────────────────────── */}
      <section className="px-4 pb-20 pt-10 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
          {(["free", "pro", "pro_max"] as PlanKey[]).map((plan) => (
            <PricingCard
              key={plan}
              plan={plan}
              interval={interval}
              isCurrentPlan={currentPlan === plan || (plan === "free" && currentPlan === "free")}
              onUpgrade={handleUpgrade}
              isLoggedIn={Boolean(user)}
              userPlan={currentPlan}
              theme="terminal"
            />
          ))}
        </div>
      </section>

      {/* ── Trust signals ─────────────────────────────────────── */}
      <section className="border-y border-[rgba(120,200,160,0.2)] px-4 py-10 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 md:grid-cols-4">
          {TRUST_SIGNALS.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0e1411]">
                <Icon className="h-4 w-4 text-[#f5a623]" />
              </div>
              <p className="text-sm font-medium text-[#ccd6cf]/80">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ──────────────────────────────────────── */}
      <section className="px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <p className="term-label mb-3 text-center">what people say</p>
          <h2 className="mb-10 text-center text-[2rem] font-semibold leading-[1.05] tracking-tight text-white">
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
      <section className="border-y border-[rgba(120,200,160,0.2)] px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-2xl">
          <p className="term-label mb-3 text-center">faq</p>
          <h2 className="mb-10 text-center text-[2rem] font-semibold leading-[1.05] tracking-tight text-white">
            Common questions
          </h2>
          <div className="term-panel px-6">
            {FAQ_ITEMS.map((item) => (
              <FaqItem key={item.q} {...item} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison table ──────────────────────────────────── */}
      <section className="px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <p className="term-label mb-3 text-center">full comparison</p>
          <h2 className="mb-10 text-center text-[2rem] font-semibold leading-[1.05] tracking-tight text-white">
            Every feature, side by side
          </h2>
          <div className="overflow-hidden term-panel">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(120,200,160,0.26)]">
                  <th className="px-4 py-4 text-left text-sm font-semibold text-[#ccd6cf]/80 w-1/2">Feature</th>
                  <th className="px-4 py-4 text-center text-sm font-semibold text-[#ccd6cf]/80">Free</th>
                  <th className="px-4 py-4 text-center text-sm font-semibold text-[#f5a623] bg-[#f5a623]/8">Pro</th>
                  <th className="px-4 py-4 text-center text-sm font-semibold text-[#f5a623]">Pro Max</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_COMPARISON_ROWS.map((row, i) => (
                  <FeatureRow key={i} {...row} theme="terminal" />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ────────────────────────────────────────── */}
      <section className="border-t border-[rgba(120,200,160,0.26)] px-4 py-24 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="term-label">{"// apply first"}</p>
          <h2 className="mt-2 text-[2rem] font-semibold leading-[1.05] tracking-tight text-white md:text-[3rem]">
            Start finding jobs the moment they <span className="text-[#f5a623]">post</span>
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/60">
            Join thousands of job seekers who apply before the crowd
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup?next=%2Fdashboard%2Fonboarding"
              className="term-btn term-btn-amber"
            >
              Get started free
            </Link>
            <Link
              href="/signup?plan=pro&interval=monthly&next=%2Fdashboard%2Fonboarding"
              className="term-btn"
            >
              Start Pro
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
