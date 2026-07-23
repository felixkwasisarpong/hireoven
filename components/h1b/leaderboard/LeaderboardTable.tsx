import Link from "next/link"
import { ChevronRight } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { ScorecardBadge } from "@/components/h1b/scorecard/ScorecardBadge"
import { LayoffSignalBadge } from "@/components/h1b/layoffs/LayoffSignalBadge"
import type { LeaderboardRow } from "@/lib/h1b/leaderboard"
import type { LayoffSignalBase } from "@/lib/h1b/layoff-signal"

function fmtPct(rate: number | null): string {
  return rate == null ? "n/a" : `${(rate * 100).toFixed(1)}%`
}

function CompanyCell({ row, priority }: { row: LeaderboardRow; priority?: boolean }) {
  return (
    <Link href={row.profile_url} className="group flex items-center gap-3">
      <CompanyLogo
        companyName={row.company.name}
        domain={row.company.domain}
        logoUrl={row.company.logo_url}
        className="h-9 w-9 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
        priority={priority}
      />
      <div className="min-w-0">
        <div className="truncate font-medium text-[#ccd6cf] group-hover:text-white">
          {row.company.name}
        </div>
        <div className="truncate text-xs text-[#ccd6cf]/45">
          {row.company.industry ?? ""}
          {row.flags.is_staffing_firm && (
            <span className="ml-2 border border-[rgba(120,200,160,0.2)] px-1 py-0.5 text-[10px] uppercase tracking-wide text-[#ccd6cf]/55">
              Staffing
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default function LeaderboardTable({
  rows,
  layoffSignals,
  startRank = 1,
}: {
  rows: LeaderboardRow[]
  layoffSignals?: Map<string, LayoffSignalBase>
  // Display rank of the first row. Ranks are sequential within the current
  // filtered/sorted view rather than each company's global rank.
  startRank?: number
}) {
  if (rows.length === 0) {
    return (
      <div className="term-panel p-8 text-center text-[#ccd6cf]/60">
        No sponsors match these filters.
      </div>
    )
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-hidden border border-[rgba(120,200,160,0.2)] md:block">
        <table className="w-full text-sm">
          <thead className="bg-[#0a0e0c] text-left text-[11px] uppercase tracking-wider text-[#ccd6cf]/45">
            <tr className="border-b border-[rgba(120,200,160,0.26)]">
              <th className="w-16 px-5 py-3.5 text-right font-medium">Rank</th>
              <th className="px-4 py-3.5 font-medium">Company</th>
              <th className="px-4 py-3.5 font-medium">Grade</th>
              <th className="px-4 py-3.5 text-right font-medium">Certified</th>
              <th className="px-4 py-3.5 text-right font-medium">Cert. rate</th>
              <th className="px-4 py-3.5 font-medium">Workforce</th>
              <th className="px-4 py-3.5 font-medium">Top states</th>
              <th className="w-10 px-4 py-3.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(120,200,160,0.12)]">
            {rows.map((row, i) => (
              <tr key={row.company.id} className="group bg-[#0e1411] transition-colors hover:bg-[#111a15]">
                <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-[#ccd6cf]/35">
                  {startRank + i}
                </td>
                <td className="px-4 py-3.5">
                  <CompanyCell row={row} priority={i < 10} />
                </td>
                <td className="px-4 py-3.5">
                  <Link href={`${row.profile_url}/scorecard`}>
                    <ScorecardBadge score={row.sponsorship_confidence ?? 0} tone="dark" />
                  </Link>
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-[#38e08a]">
                  {row.metrics.certified.toLocaleString()}
                </td>
                <td className="px-4 py-3.5 text-right tabular-nums text-[#f5a623]">
                  {fmtPct(row.metrics.cert_rate)}
                </td>
                <td className="px-4 py-3.5">
                  {layoffSignals?.get(row.company.id) && (
                    <LayoffSignalBadge signal={layoffSignals.get(row.company.id)!} size="sm" />
                  )}
                </td>
                <td className="px-4 py-3.5 text-xs text-[#ccd6cf]/45">
                  {row.metrics.top_states.slice(0, 3).join(", ")}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <Link
                    href={row.profile_url}
                    className="inline-flex text-[#ccd6cf]/25 transition-colors group-hover:text-[#38e08a]"
                    aria-label={`View ${row.company.name}`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row, i) => (
          <li
            key={row.company.id}
            className="flex items-center gap-3 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-3"
          >
            <span className="w-7 shrink-0 text-right font-semibold tabular-nums text-[#ccd6cf]/35">
              {startRank + i}
            </span>
            <div className="min-w-0 flex-1">
              <CompanyCell row={row} priority={i < 6} />
              <div className="mt-1 flex items-center gap-1.5">
                <Link href={`${row.profile_url}/scorecard`} className="inline-block">
                  <ScorecardBadge score={row.sponsorship_confidence ?? 0} tone="dark" />
                </Link>
                {layoffSignals?.get(row.company.id) &&
                  layoffSignals.get(row.company.id)!.level !== "stable" && (
                    <LayoffSignalBadge signal={layoffSignals.get(row.company.id)!} size="sm" />
                  )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-semibold tabular-nums text-[#38e08a]">
                {row.metrics.certified.toLocaleString()}
              </div>
              <div className="text-xs text-[#f5a623]">{fmtPct(row.metrics.cert_rate)}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
