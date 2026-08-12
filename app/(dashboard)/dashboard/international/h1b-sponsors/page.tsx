import LeaderboardView from "@/components/h1b/leaderboard/LeaderboardView"
import type { LeaderboardFilters } from "@/lib/h1b/leaderboard"

export const dynamic = "force-dynamic"

// The H-1B Sponsor Leaderboard, rendered inside the dashboard shell so an
// authenticated user clicking the sidebar item stays in the app instead of
// being ejected to the public marketing page (T1-02). Reuses the same
// LeaderboardView as the public route; `basePath` keeps pagination/filter links
// inside the dashboard.
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

export default function DashboardH1BSponsorsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <LeaderboardView
        filters={parseFilters(searchParams)}
        basePath="/dashboard/international/h1b-sponsors"
        searchParams={searchParams}
        title="H-1B Sponsor Leaderboard"
        subtitle="U.S. employers ranked by certified H-1B LCA filings (FY2025), sourced from Department of Labor public disclosure data."
        sharePath="/h1b-sponsors/leaderboard"
        shareText="The top U.S. H-1B sponsors, ranked by certified LCA filings (FY2025):"
      />
    </main>
  )
}
