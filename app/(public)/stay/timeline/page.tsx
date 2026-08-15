import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import TimelineCopilot from "@/components/stay/TimelineCopilot"

export const metadata: Metadata = {
  title: "Timeline Copilot — race the OPT clock | Stay by Hireoven",
  description:
    "Enter your OPT clock and target salary. The Stay timeline copilot shows your runway, your real H-1B draws left, your weighted-lottery odds, and what to do this week.",
  alternates: { canonical: "/stay/timeline" },
}

export default function StayTimelinePage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      <section className="mx-auto w-full max-w-[78rem] px-4 pt-12 sm:px-6 sm:pt-16 lg:px-10">
        <Link href="/stay" className="term-label transition-colors hover:text-[#38e08a]">
          &lt; stay
        </Link>
        <h1 className="mt-4 max-w-[22ch] text-[2.3rem] font-semibold leading-[1.04] tracking-tight text-white sm:text-[3.1rem]">
          The clock copilot for your <span className="text-[#f5a623]">OPT runway</span>
        </h1>
        <p className="mt-5 max-w-[64ch] text-[16px] leading-relaxed text-[#ccd6cf]/70">
          The 2026 rules turned the job search into a countdown: a shorter runway, a 30-day grace period, and a
          lottery weighted against entry-level pay. Enter your situation and see the runway, your real number of
          H-1B draws, your weighted odds, and the moves that actually fit your clock.
        </p>
      </section>

      <section className="mx-auto mt-8 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <TimelineCopilot />
      </section>

      <section className="mx-auto mt-14 mb-20 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <div className="term-panel flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-[15px] font-semibold text-white">Save your timeline and get weekly nudges</p>
            <p className="mt-1 text-[13px] text-[#ccd6cf]/60">Early members get the copilot wired into their dashboard first.</p>
          </div>
          <Link href="/signup?next=%2Fdashboard%2Fonboarding" className="term-btn term-btn-amber shrink-0">
            Get early access <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
