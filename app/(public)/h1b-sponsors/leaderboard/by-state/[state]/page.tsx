import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import LeaderboardView from "@/components/h1b/leaderboard/LeaderboardView"
import type { LeaderboardFilters } from "@/lib/h1b/leaderboard"

export const revalidate = 3600
export const dynamicParams = true

const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]

export function generateStaticParams() {
  return STATES.map((state) => ({ state }))
}

type SearchParams = Record<string, string | undefined>

function stateCode(raw: string): string | null {
  const s = raw.toUpperCase()
  return STATES.includes(s) ? s : null
}

export function generateMetadata({
  params,
}: {
  params: { state: string }
}): Metadata {
  const st = stateCode(params.state)
  const title = st
    ? `Top H-1B Sponsors in ${st} (FY2025)`
    : "H-1B Sponsor Leaderboard"
  return {
    title,
    description: `U.S. employers in ${st ?? ""} ranked by certified H-1B LCA filings (FY2025), from Department of Labor public data.`,
    alternates: { canonical: `/h1b-sponsors/leaderboard/by-state/${st ?? params.state}` },
  }
}

export default function ByStatePage({
  params,
  searchParams,
}: {
  params: { state: string }
  searchParams: SearchParams
}) {
  const st = stateCode(params.state)
  if (!st) notFound()

  const filters: LeaderboardFilters = {
    sort: searchParams.sort === "cert_rate" ? "cert_rate" : "volume",
    industry: searchParams.industry,
    exclude_staffing: searchParams.exclude_staffing === "true",
    state: st,
    cursor: searchParams.cursor ? Number(searchParams.cursor) : undefined,
  }
  const basePath = `/h1b-sponsors/leaderboard/by-state/${st}`

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <LeaderboardView
        filters={filters}
        basePath={basePath}
        searchParams={searchParams}
        title={`Top H-1B Sponsors in ${st}`}
        subtitle={`Employers with H-1B LCA worksites in ${st}, ranked by certified filings (FY2025).`}
        sharePath={basePath}
        shareText={`The top H-1B sponsors in ${st}, ranked by certified LCA filings (FY2025):`}
        lockState
      />
    </div>
  )
}
