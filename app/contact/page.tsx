import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, LifeBuoy, Mail, MessageSquareText, Scale, ShieldCheck } from "lucide-react"
import Navbar from "@/components/layout/Navbar"

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
    accent: "#2563EB",
  },
  {
    icon: Scale,
    title: "Legal",
    blurb: "Terms of service, agreements, and compliance.",
    email: "legal@hireoven.com",
    accent: "#7C3AED",
  },
  {
    icon: ShieldCheck,
    title: "Privacy",
    blurb: "Data access, deletion, and privacy questions.",
    email: "privacy@hireoven.com",
    accent: "#10b981",
  },
]

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="px-6 pt-14 pb-10">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0C0A1E] via-[#16102e] to-[#1a0a2e] px-8 py-14 text-center shadow-[0_30px_80px_-40px_rgba(124,58,237,0.6)] sm:px-14">
            <span aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#FF5C18]/15 blur-[80px]" />
            <span aria-hidden className="pointer-events-none absolute -left-16 bottom-0 h-48 w-48 rounded-full bg-violet-500/15 blur-[70px]" />
            <div className="relative">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/70 ring-1 ring-white/15">
                <Mail className="h-3 w-3" />
                Contact
              </span>
              <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-5xl">
                Let&apos;s talk.
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/60">
                Questions, feedback, or something urgent? Email the right team below and a real
                human replies — usually within one business day.
              </p>
              <a
                href="mailto:support@hireoven.com"
                className="group mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[14px] font-bold text-slate-900 transition hover:bg-[#FF5C18] hover:text-white"
              >
                Email support
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>
        </section>

        {/* ── Channels ─────────────────────────────────────────────────── */}
        <section className="px-6 pb-16">
          <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
            {CHANNELS.map((c) => {
              const Icon = c.icon
              return (
                <a
                  key={c.email}
                  href={`mailto:${c.email}`}
                  className="group flex items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_20px_50px_-30px_rgba(15,23,42,0.4)]"
                >
                  <span
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${c.accent}, ${c.accent}cc)` }}
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-bold text-slate-900">{c.title}</h2>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{c.blurb}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-900 transition group-hover:text-[#FF5C18]">
                      {c.email}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </a>
              )
            })}
          </div>

          {/* Helper row */}
          <div className="mx-auto mt-10 max-w-5xl rounded-2xl border border-slate-200/80 bg-slate-50/60 px-6 py-5 text-center text-[13px] text-slate-500 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:text-left">
            <p>
              Looking for quick answers first? Our{" "}
              <Link href="/support" className="font-semibold text-[#0369A1] hover:underline">
                Support &amp; FAQ
              </Link>{" "}
              covers the extension, billing, and account questions.
            </p>
            <Link
              href="/support"
              className="mt-3 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition hover:border-slate-400 sm:mt-0"
            >
              Visit Support
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <p className="mx-auto mt-8 max-w-5xl text-center text-[12px] text-slate-400">
            Hireoven is an independent product. © {new Date().getFullYear()} Hireoven. All rights reserved.
          </p>
        </section>
      </main>
    </div>
  )
}
