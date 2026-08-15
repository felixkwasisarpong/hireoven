import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import RulesChecker from "@/components/stay/RulesChecker"

export const metadata: Metadata = {
  title: "Do the 2026 H-1B rules actually apply to you? | Stay by Hireoven",
  description:
    "The calm version. Which of the 2026 changes — the wage-weighted lottery, the $100k fee, the 30-day rule — actually hit your situation, and what to do about each.",
  alternates: { canonical: "/stay/rules" },
}

export default function StayRulesPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      <section className="mx-auto w-full max-w-[78rem] px-4 pt-12 sm:px-6 sm:pt-16 lg:px-10">
        <Link href="/stay" className="term-label transition-colors hover:text-[#38e08a]">
          &lt; stay
        </Link>
        <h1 className="mt-4 max-w-[24ch] text-[2.3rem] font-semibold leading-[1.04] tracking-tight text-white sm:text-[3.1rem]">
          Which 2026 rules <span className="text-[#f5a623]">actually apply to you?</span>
        </h1>
        <p className="mt-5 max-w-[64ch] text-[16px] leading-relaxed text-[#ccd6cf]/70">
          The panic is loud and mostly imprecise. Here&apos;s the calm version — pick your situation and see which of
          the three changes actually hit you, and what to do about each.
        </p>
      </section>

      {/* The big misconception, up front */}
      <section className="mx-auto mt-8 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <div className="border border-[#38e08a]/30 bg-[#38e08a]/[0.06] p-5 sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#38e08a]">the reassuring truth</p>
          <p className="mt-2 text-[15px] leading-relaxed text-[#ccd6cf]/85">
            The <span className="text-white">$100,000 H-1B fee</span> that&apos;s scaring everyone{" "}
            <span className="text-[#38e08a]">largely does NOT apply</span> to F-1 students already in the US filing a
            change of status — it targets petitions that need consular processing from outside the country. Don&apos;t
            let a headline aimed elsewhere steer your search.
          </p>
        </div>
      </section>

      {/* Interactive checker */}
      <section className="mx-auto mt-8 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <RulesChecker />
      </section>

      {/* CTA */}
      <section className="mx-auto mt-14 mb-20 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <div className="term-panel flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-[15px] font-semibold text-white">Now score real jobs against your odds</p>
            <p className="mt-1 text-[13px] text-[#ccd6cf]/60">See the survival odds on every posting and the roles that skip the lottery.</p>
          </div>
          <Link href="/stay" className="term-btn term-btn-amber shrink-0">
            Open Stay <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
