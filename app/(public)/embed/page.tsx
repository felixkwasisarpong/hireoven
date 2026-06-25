import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import { getH1bLeaderboard } from "@/lib/h1b/leaderboard"

export const revalidate = 3600

export const metadata: Metadata = {
  title: "Embeddable H-1B Widgets — Hireoven",
  description:
    "Free embeddable widgets for any site: H-1B sponsor leaderboard, company sponsorability scorecards, and personal scorecards. Copy one line of HTML.",
  alternates: { canonical: "/embed" },
}

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

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
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{blurb}</p>
      <div className="mt-4 flex flex-1 items-center justify-center rounded-xl bg-slate-50 p-4">
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
        className="mt-4 text-sm font-medium text-emerald-700 underline hover:text-emerald-900"
      >
        Get the embed code →
      </Link>
    </div>
  )
}

export default async function EmbedGalleryPage() {
  const companyId = await previewCompanyId()

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-12">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Embeddable H-1B widgets
          </h1>
          <p className="mt-3 text-slate-600">
            Add live H-1B data to any site with one line of HTML. Widgets render server-side,
            load fast, and need no JavaScript on your page. Free to use with a small attribution
            link.
          </p>
          <div className="mt-5 flex gap-3">
            <Link
              href="/embed/docs"
              className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Read the docs
            </Link>
            <Link
              href="/dashboard/scorecard"
              className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
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

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Personal sponsorability scorecard</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Show your own H-1B sponsorability grade on your portfolio or résumé site. Publish your
            scorecard from your dashboard, then copy the embed snippet — it stays in sync as you
            update your résumé, and you can revoke it any time.
          </p>
          <Link
            href="/dashboard/scorecard"
            className="mt-4 inline-block text-sm font-medium text-emerald-700 underline hover:text-emerald-900"
          >
            Publish &amp; embed your scorecard →
          </Link>
        </div>
      </main>
    </div>
  )
}
