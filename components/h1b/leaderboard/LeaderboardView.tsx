import Link from "next/link"
import {
  getH1bLeaderboard,
  getLeaderboardIndustries,
  type LeaderboardFilters as Filters,
} from "@/lib/h1b/leaderboard"
import { getCompanyLayoffSignalsBatch } from "@/lib/h1b/layoff-signal-query"
import LeaderboardTable from "./LeaderboardTable"
import LeaderboardFilters from "./LeaderboardFilters"
import LeaderboardPodium from "./LeaderboardPodium"
import ShareLeaderboard from "./ShareLeaderboard"

const PAGE_SIZE = 50

type SearchParams = Record<string, string | undefined>

function buildHref(
  basePath: string,
  searchParams: SearchParams,
  cursor: number | null,
  from: number | null
): string {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (v != null && v !== "" && k !== "cursor" && k !== "from") next.set(k, v)
  }
  if (cursor != null) next.set("cursor", String(cursor))
  if (from != null && from > 0) next.set("from", String(from))
  const qs = next.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export default async function LeaderboardView({
  filters,
  basePath,
  searchParams,
  title,
  subtitle,
  sharePath,
  shareText,
  lockState,
  lockIndustry,
}: {
  filters: Filters
  basePath: string
  searchParams: SearchParams
  title: string
  subtitle: string
  sharePath: string
  shareText: string
  lockState?: boolean
  lockIndustry?: boolean
}) {
  const [data, industries] = await Promise.all([
    getH1bLeaderboard({ ...filters, limit: PAGE_SIZE }),
    getLeaderboardIndustries(),
  ]).catch(() => [
    { results: [], next_cursor: null, total_count: 0, refreshed_at: null },
    [],
  ] satisfies [Awaited<ReturnType<typeof getH1bLeaderboard>>, string[]])

  // One batched query for all rows' layoff badges (no N+1). Treat layoff badges
  // as non-critical SEO decoration; the leaderboard page should still render.
  const layoffSignals = await getCompanyLayoffSignalsBatch(data.results.map((r) => r.company.id)).catch(
    () => new Map(),
  )

  const cursor = filters.cursor ?? 0
  // Display ranks are contiguous within the current filter/sort view (1, 2, 3, …),
  // independent of each company's global rank — so post-rank filters (exclude
  // staffing, etc.) never leave visible gaps. `from` carries the running offset
  // across pages; keyset pagination still runs on the global rank underneath.
  const fromParam = Number(searchParams.from ?? "0")
  const startIndex = Number.isFinite(fromParam) && fromParam > 0 ? Math.floor(fromParam) : 0
  const nextFrom = startIndex + data.results.length

  // Page 1 gets a top-3 "podium"; the table then starts at rank 4 (mirrors the
  // reference design). Require ≥4 rows so the table never renders empty below it.
  const showPodium = cursor === 0 && startIndex === 0 && data.results.length >= 4
  const tableRows = showPodium ? data.results.slice(3) : data.results
  const tableStart = startIndex + (showPodium ? 3 : 0)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    itemListElement: data.results.map((r, i) => ({
      "@type": "ListItem",
      position: startIndex + i + 1,
      item: { "@type": "Organization", name: r.company.name, url: r.profile_url },
    })),
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-orange-700">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(255,92,24,0.6)]" />
                FY2025 · DOL disclosure data
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">{subtitle}</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div className="text-base font-semibold tabular-nums text-slate-900">
                {data.total_count.toLocaleString()}
              </div>
              <div>employers ranked</div>
              {data.refreshed_at && (
                <div className="mt-1">
                  Updated {new Date(data.refreshed_at).toLocaleDateString()}
                </div>
              )}
              <Link
                href="/h1b-sponsors/leaderboard/methodology"
                className="mt-1 inline-block text-slate-500 underline underline-offset-2 hover:text-slate-600"
              >
                Methodology
              </Link>
            </div>
          </header>

          <LeaderboardFilters
            industries={industries}
            lockState={lockState}
            lockIndustry={lockIndustry}
          />

          {showPodium && (
            <div className="mb-6 mt-1">
              <LeaderboardPodium rows={data.results} />
            </div>
          )}

          <LeaderboardTable
            rows={tableRows}
            layoffSignals={layoffSignals}
            startRank={tableStart + 1}
          />

          <nav className="mt-6 flex items-center justify-between text-sm">
            {cursor > 0 ? (
              <Link
                href={buildHref(basePath, searchParams, null, null)}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-slate-600 transition-colors hover:bg-slate-50"
              >
                ← Top of list
              </Link>
            ) : (
              <span />
            )}
            {data.next_cursor != null ? (
              <Link
                href={buildHref(basePath, searchParams, data.next_cursor, nextFrom)}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-slate-600 transition-colors hover:bg-slate-50"
              >
                Next {PAGE_SIZE} →
              </Link>
            ) : (
              <span />
            )}
          </nav>

      <ShareLeaderboard path={sharePath} text={shareText} />
    </main>
  )
}
