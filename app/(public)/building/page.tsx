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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white/90 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <HireovenLogo className="h-8 w-auto" />
          </Link>
          <Link
            href="/launch"
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            Join waitlist
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-14">
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          Build log
        </p>
        <h1 className="mt-2 text-3xl font-extrabold text-strong">Building in public</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          Honest updates on what shipped each week. Tweet the highlights - link candidates here
          for proof we&apos;re real.
        </p>

        <ol className="mt-12 space-y-10">
          {ENTRIES.map((e) => (
            <li key={e.date} className="border-b border-border pb-10 last:border-0">
              <time
                dateTime={e.date}
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {e.date}
              </time>
              <h2 className="mt-2 text-xl font-bold text-strong">{e.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{e.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-12 text-center text-sm text-muted-foreground">
          <Link href="/launch" className="font-semibold text-teal-700 hover:underline">
            Get on the waitlist →
          </Link>
        </p>
      </main>
    </div>
  )
}
