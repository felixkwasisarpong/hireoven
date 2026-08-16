import type { Metadata } from "next"
import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"

export const metadata: Metadata = {
  title: "Building in public - Hireoven",
  description: "Weekly changelog: what we shipped for real-time jobs and international candidates.",
}

const ENTRIES = [
  {
    date: "2026-04-14",
    title: "Cover letter generator shipped - 10,000 jobs in the database",
    body: "You can draft role-specific cover letters from a job + resume context. Our job index crossed five figures as crawls widened.",
  },
  {
    date: "2026-04-07",
    title: "Resume upload and AI parsing live - match scores on the feed",
    body: "Upload a PDF or DOCX and get structured fields plus match scoring against fresh listings.",
  },
  {
    date: "2026-03-31",
    title: "Added H1B sponsorship scores - integrated USCIS public data",
    body: "Every company now carries a sponsorship confidence score grounded in real petition history.",
  },
  {
    date: "2026-03-24",
    title: "Crawling 50 company career pages - detecting jobs within 30 minutes",
    body: "End-to-end pipeline from crawl to normalized job records with freshness timestamps.",
  },
]

export default function BuildingInPublicPage() {
  return (
    <div className="term-page min-h-dvh">
      <header className="term-nav border-b border-[rgba(120,200,160,0.26)] px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <HireovenLogo className="h-8 w-auto" />
          </Link>
          <Link href="/launch" className="term-btn">
            Join waitlist
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-14">
        <p className="term-label">{"Build log"}</p>
        <h1 className="mt-3 text-[2.3rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[3.1rem]">
          Building in <span className="text-[#f5a623]">public</span>
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#ccd6cf]/70">
          Honest updates on what shipped each week. Tweet the highlights - link candidates here
          for proof we&apos;re real.
        </p>

        <ol className="mt-12 divide-y divide-[rgba(120,200,160,0.12)] border-x border-b border-t border-[rgba(120,200,160,0.2)]">
          {ENTRIES.map((e) => (
            <li key={e.date} className="term-panel-hover bg-[#0e1411] p-5">
              <time dateTime={e.date} className="term-label">
                {e.date}
              </time>
              <h2 className="mt-2 text-[16px] font-semibold text-white">{e.title}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[#ccd6cf]/65">{e.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-12 text-center">
          <Link
            href="/launch"
            className="text-[13px] font-semibold text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
          >
            Get on the waitlist →
          </Link>
        </p>
      </main>
    </div>
  )
}
