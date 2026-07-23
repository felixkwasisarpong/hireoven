import type { Metadata } from "next"
import Navbar from "@/components/layout/Navbar"
import LeaderboardView from "@/components/h1b/leaderboard/LeaderboardView"
import type { LeaderboardFilters } from "@/lib/h1b/leaderboard"

export const revalidate = 3600

export const metadata: Metadata = {
  title: "Top U.S. H-1B Visa Sponsors (FY2025 Leaderboard)",
  description:
    "U.S. employers ranked by certified H-1B LCA filings and certification rate. Sourced from Department of Labor FY2025 disclosure data. Updated nightly.",
  alternates: { canonical: "/h1b-sponsors/leaderboard" },
  openGraph: {
    title: "H-1B Sponsor Leaderboard (FY2025)",
    description: "Top U.S. H-1B sponsors ranked by certified LCA filings.",
    type: "website",
  },
}

type SearchParams = Record<string, string | undefined>

function parseFilters(sp: SearchParams): LeaderboardFilters {
  return {
    sort: sp.sort === "cert_rate" ? "cert_rate" : "volume",
    state: sp.state,
    industry: sp.industry,
    exclude_staffing: sp.exclude_staffing === "true",
    layoff_risk:
      sp.layoff_risk === "exclude_active" || sp.layoff_risk === "stable_only"
        ? sp.layoff_risk
        : undefined,
    cap_exempt_only: sp.cap_exempt_only === "true",
    e_verify_only: sp.e_verify_only === "true",
    cursor: sp.cursor ? Number(sp.cursor) : undefined,
  }
}

export default function LeaderboardPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <LeaderboardView
        filters={parseFilters(searchParams)}
        basePath="/h1b-sponsors/leaderboard"
        searchParams={searchParams}
        title="H-1B Sponsor Leaderboard"
        subtitle="U.S. employers ranked by certified H-1B LCA filings (FY2025), sourced from Department of Labor public disclosure data."
        sharePath="/h1b-sponsors/leaderboard"
        shareText="The top U.S. H-1B sponsors, ranked by certified LCA filings (FY2025):"
      />
    </div>
  )
}
