import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import LeaderboardView from "@/components/h1b/leaderboard/LeaderboardView"
import {
  getLeaderboardIndustries,
  industryFromSlug,
  industrySlug,
  type LeaderboardFilters,
} from "@/lib/h1b/leaderboard"

export const revalidate = 3600
export const dynamicParams = true

// Pre-render top industries; wrapped so a DB-less build (CI) just renders on demand.
export async function generateStaticParams() {
  try {
    const industries = await getLeaderboardIndustries()
    return industries.slice(0, 20).map((industry) => ({ slug: industrySlug(industry) }))
  } catch {
    return []
  }
}

type SearchParams = Record<string, string | undefined>

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const industry = await industryFromSlug(params.slug)
  const title = industry
    ? `Top H-1B Sponsors in ${industry} (FY2025)`
    : "H-1B Sponsor Leaderboard"
  return {
    title,
    description: `${industry ?? "U.S."} employers ranked by certified H-1B LCA filings (FY2025), from Department of Labor public data.`,
    alternates: { canonical: `/h1b-sponsors/leaderboard/by-industry/${params.slug}` },
  }
}

export default async function ByIndustryPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: SearchParams
}) {
  const industry = await industryFromSlug(params.slug)
  if (!industry) notFound()

  const filters: LeaderboardFilters = {
    sort: searchParams.sort === "cert_rate" ? "cert_rate" : "volume",
    state: searchParams.state,
    exclude_staffing: searchParams.exclude_staffing === "true",
    industry,
    cursor: searchParams.cursor ? Number(searchParams.cursor) : undefined,
  }
  const basePath = `/h1b-sponsors/leaderboard/by-industry/${params.slug}`

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <Navbar />
      <LeaderboardView
        filters={filters}
        basePath={basePath}
        searchParams={searchParams}
        title={`Top H-1B Sponsors in ${industry}`}
        subtitle={`${industry} employers ranked by certified H-1B LCA filings (FY2025).`}
        sharePath={basePath}
        shareText={`The top H-1B sponsors in ${industry}, ranked by certified LCA filings (FY2025):`}
        lockIndustry
      />
    </div>
  )
}
