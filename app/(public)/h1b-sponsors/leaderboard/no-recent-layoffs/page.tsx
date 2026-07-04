import type { Metadata } from "next"
import Navbar from "@/components/layout/Navbar"
import LeaderboardView from "@/components/h1b/leaderboard/LeaderboardView"
import type { LeaderboardFilters } from "@/lib/h1b/leaderboard"

export const revalidate = 86400

export const metadata: Metadata = {
  title: "H-1B Sponsors With No Recent Layoffs (FY2025)",
  description:
    "U.S. H-1B sponsors with no layoff events or hiring freezes reported in public DOL WARN data in the last 12 months, ranked by certified LCA filings.",
  alternates: { canonical: "/h1b-sponsors/leaderboard/no-recent-layoffs" },
  openGraph: {
    title: "H-1B Sponsors With No Recent Layoffs",
    description: "Top H-1B sponsors that are still hiring — no recent WARN layoff activity.",
    type: "website",
  },
}

type SearchParams = Record<string, string | undefined>

export default function NoRecentLayoffsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const filters: LeaderboardFilters = {
    sort: searchParams.sort === "cert_rate" ? "cert_rate" : "volume",
    state: searchParams.state,
    industry: searchParams.industry,
    exclude_staffing: searchParams.exclude_staffing === "true",
    layoff_risk: "stable_only",
    cursor: searchParams.cursor ? Number(searchParams.cursor) : undefined,
  }
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <Navbar />
      <LeaderboardView
        filters={filters}
        basePath="/h1b-sponsors/leaderboard/no-recent-layoffs"
        searchParams={searchParams}
        title="H-1B Sponsors With No Recent Layoffs"
        subtitle="H-1B sponsors with no layoff events or hiring freezes reported in public DOL WARN data in the last 12 months, ranked by certified LCA filings (FY2025)."
        sharePath="/h1b-sponsors/leaderboard/no-recent-layoffs"
        shareText="H-1B sponsors that are still hiring — no recent reported layoffs:"
      />
    </div>
  )
}
