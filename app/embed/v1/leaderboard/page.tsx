import { headers } from "next/headers"
import { getH1bLeaderboard, type LeaderboardFilters } from "@/lib/h1b/leaderboard"
import { resolveEmbedToken } from "@/lib/embed/tokens"
import { logEmbedImpression } from "@/lib/embed/log"
import { resolveTheme } from "@/lib/embed/themes"
import { LeaderboardWidget } from "@/components/embed/LeaderboardWidget"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

type SearchParams = Record<string, string | undefined>

const STATE_RE = /^[A-Za-z]{2}$/

export default async function LeaderboardEmbed({ searchParams }: { searchParams: SearchParams }) {
  const theme = resolveTheme(searchParams.theme)
  const token = await resolveEmbedToken(searchParams.token)
  const showAttribution = token ? token.showAttribution : true

  const limit = Math.min(Math.max(Number(searchParams.limit) || 10, 3), 15)
  const state = searchParams.state && STATE_RE.test(searchParams.state) ? searchParams.state.toUpperCase() : undefined
  const sort: LeaderboardFilters["sort"] = searchParams.sort === "cert_rate" ? "cert_rate" : "volume"

  const h = headers()
  logEmbedImpression({
    widgetType: "leaderboard",
    subjectId: state ? `state:${state}` : null,
    referer: h.get("referer"),
    userAgent: h.get("user-agent"),
    embedTokenId: token?.id ?? null,
  })

  const { results } = await getH1bLeaderboard({ sort, state, exclude_staffing: searchParams.exclude_staffing === "true", limit })

  const title = state ? `Top H-1B Sponsors · ${state}` : "Top H-1B Sponsors"
  const href = state ? `/h1b-sponsors/leaderboard/by-state/${state}` : "/h1b-sponsors/leaderboard"

  return (
    <LeaderboardWidget
      rows={results}
      theme={theme}
      showAttribution={showAttribution}
      baseUrl={BASE}
      title={title}
      href={href}
    />
  )
}
