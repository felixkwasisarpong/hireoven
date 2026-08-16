import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import { getH1bLeaderboard } from "@/lib/h1b/leaderboard"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const revalidate = 3600

export const metadata: Metadata = {
  title: "Embeddable H-1B Widgets — Hireoven",
  description:
    "Free embeddable widgets for any site: H-1B sponsor leaderboard, company sponsorability scorecards, and personal scorecards. Copy one line of HTML.",
  alternates: { canonical: "/embed" },
}

const BASE = siteBaseUrl()

// A real sponsor to preview the company widget with. Falls back gracefully if the
// leaderboard is empty at render time.
async function previewCompanyId(): Promise<string | null> {
  const { results } = await getH1bLeaderboard({ sort: "volume", limit: 1 })
  return results[0]?.company.id ?? null
}

function WidgetCard({
  title,
  blurb,
  src,
  height,
  docsAnchor,
}: {
  title: string
  blurb: string
  src: string
  height: number
  docsAnchor: string
}) {
  return (
    <div className="term-panel flex flex-col p-5">
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-[#ccd6cf]/60">{blurb}</p>
      <div className="mt-4 flex flex-1 items-center justify-center border border-[rgba(120,200,160,0.12)] bg-[#0a0e0c] p-4">
        <iframe
          src={src}
          width={420}
          height={height}
          style={{ border: 0, maxWidth: "100%" }}
          loading="lazy"
          title={title}
        />
      </div>
      <Link
        href={`/embed/docs#${docsAnchor}`}
        className="mt-4 text-[13px] font-semibold text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
      >
        Get the embed code →
      </Link>
    </div>
  )
}

export default async function EmbedGalleryPage() {
  const companyId = await previewCompanyId()

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-12">
        <div className="max-w-2xl">
          <p className="term-label">{"Embed"}</p>
          <h1 className="mt-3 text-[2.3rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[3.1rem]">
            Embeddable <span className="text-[#f5a623]">H-1B widgets</span>
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Add live H-1B data to any site with one line of HTML. Widgets render server-side,
            load fast, and need no JavaScript on your page. Free to use with a small attribution
            link.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/embed/docs" className="term-btn term-btn-amber">
              Read the docs
            </Link>
            <Link href="/signup?next=%2Fdashboard%2Fscorecard" className="term-btn">
              Embed your own scorecard
            </Link>
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <WidgetCard
            title="Top H-1B Sponsors leaderboard"
            blurb="A ranked list of employers by certified LCA filings. Filter by state or sort by certification rate."
            src={`${BASE}/embed/v1/leaderboard?theme=light&limit=6`}
            height={340}
            docsAnchor="leaderboard"
          />
          {companyId ? (
            <WidgetCard
              title="Company sponsorability scorecard"
              blurb="A single company's H-1B grade, certified filings, certification rate, and sponsor rank."
              src={`${BASE}/embed/v1/company-scorecard/${companyId}?theme=light`}
              height={250}
              docsAnchor="company"
            />
          ) : null}
        </div>

        <div className="term-panel mt-6 p-6">
          <h2 className="text-[15px] font-semibold text-white">Personal sponsorability scorecard</h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#ccd6cf]/60">
            Show your own H-1B sponsorability grade on your portfolio or résumé site. Publish your
            scorecard from your dashboard, then copy the embed snippet — it stays in sync as you
            update your résumé, and you can revoke it any time.
          </p>
          <Link
            href="/signup?next=%2Fdashboard%2Fscorecard"
            className="mt-4 inline-block text-[13px] font-semibold text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
          >
            Publish &amp; embed your scorecard →
          </Link>
        </div>
      </main>
    </div>
  )
}
