import Link from "next/link"
import {
  getH1bLeaderboard,
  getLeaderboardIndustries,
  type LeaderboardFilters as Filters,
} from "@/lib/h1b/leaderboard"
import { getCompanyLayoffSignalsBatch } from "@/lib/h1b/layoff-signal-query"
import LeaderboardTable from "./LeaderboardTable"
import LeaderboardFilters from "./LeaderboardFilters"
import ShareLeaderboard from "./ShareLeaderboard"

const PAGE_SIZE = 50

type SearchParams = Record<string, string | undefined>

function buildHref(basePath: string, searchParams: SearchParams, cursor: number | null): string {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (v != null && v !== "" && k !== "cursor") next.set(k, v)
  }
  if (cursor != null) next.set("cursor", String(cursor))
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
  ])

  // One batched query for all rows' layoff badges (no N+1).
  const layoffSignals = await getCompanyLayoffSignalsBatch(data.results.map((r) => r.company.id))

  const cursor = filters.cursor ?? 0
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    itemListElement: data.results.map((r) => ({
      "@type": "ListItem",
      position: r.rank,
      item: { "@type": "Organization", name: r.company.name, url: r.profile_url },
    })),
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-2 text-slate-600">{subtitle}</p>
        <p className="mt-1 text-xs text-slate-400">
          {data.total_count.toLocaleString()} employers
          {data.refreshed_at
            ? ` · updated ${new Date(data.refreshed_at).toLocaleDateString()}`
            : ""}{" "}
          ·{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology" className="underline hover:text-slate-600">
            Methodology
          </Link>
        </p>
      </header>

      <LeaderboardFilters
        industries={industries}
        lockState={lockState}
        lockIndustry={lockIndustry}
      />

      <LeaderboardTable rows={data.results} layoffSignals={layoffSignals} />

      <nav className="mt-6 flex items-center justify-between text-sm">
        {cursor > 0 ? (
          <Link
            href={buildHref(basePath, searchParams, null)}
            className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            ← Top of list
          </Link>
        ) : (
          <span />
        )}
        {data.next_cursor != null ? (
          <Link
            href={buildHref(basePath, searchParams, data.next_cursor)}
            className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-slate-600 hover:bg-slate-50"
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
