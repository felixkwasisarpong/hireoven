import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, LifeBuoy, MessageSquareText, Scale, ShieldCheck } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import MarketingFooter from "@/components/marketing/MarketingFooter"

export const metadata: Metadata = {
  title: "Contact Hireoven — Get in touch",
  description:
    "Reach the Hireoven team. Support, general enquiries, legal, and privacy — email us directly and a real human replies, usually within one business day.",
}

const CHANNELS = [
  {
    icon: LifeBuoy,
    title: "Support",
    blurb: "Trouble with the app, the extension, or your account.",
    email: "support@hireoven.com",
    accent: "#FF5C18",
  },
  {
    icon: MessageSquareText,
    title: "General & partnerships",
    blurb: "Press, partnerships, feedback — anything else.",
    email: "hello@hireoven.com",
    accent: "#0f172a",
  },
  {
    icon: Scale,
    title: "Legal",
    blurb: "Terms of service, agreements, and compliance.",
    email: "legal@hireoven.com",
    accent: "#64748B",
  },
  {
    icon: ShieldCheck,
    title: "Privacy",
    blurb: "Data access, deletion, and privacy questions.",
    email: "privacy@hireoven.com",
    accent: "#FF5C18",
  },
]

export default function ContactPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-3xl px-6 pt-14 pb-10">
          <p className="term-label">Contact</p>
          <h1 className="mt-4 text-[2.3rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[3.1rem]">
            Let&apos;s <span className="text-[#f5a623]">talk</span>
          </h1>
          <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Questions, feedback, or something urgent? Email the right team below and a real
            human replies — usually within one business day.
          </p>
          <a href="mailto:support@hireoven.com" className="term-btn term-btn-amber mt-7">
            Email support
            <ArrowRight className="h-4 w-4" />
          </a>
        </section>

        {/* ── Channels ─────────────────────────────────────────────────── */}
        <section className="px-6 pb-16">
          <div className="mx-auto grid max-w-3xl gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-2">
            {CHANNELS.map((c) => {
              const Icon = c.icon
              return (
                <a
                  key={c.email}
                  href={`mailto:${c.email}`}
                  className="term-panel-hover group flex items-start gap-4 bg-[#0e1411] p-6"
                >
                  <span
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]"
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-white">{c.title}</h2>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-[#ccd6cf]/55">{c.blurb}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#ccd6cf]/80 transition group-hover:text-[#38e08a]">
                      {c.email}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </a>
              )
            })}
          </div>

          {/* Helper row */}
          <div className="mx-auto mt-10 max-w-3xl border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-6 py-5 text-center text-[13px] text-[#ccd6cf]/55 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:text-left">
            <p>
              Looking for quick answers first? Our{" "}
              <Link href="/support" className="font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
                Support &amp; FAQ
              </Link>{" "}
              covers the extension, billing, and account questions.
            </p>
            <Link href="/support" className="term-btn mt-3 sm:mt-0">
              Visit Support
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
