import Link from "next/link"
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
    <Link href={row.profile_url} className="flex items-center gap-3 group">
      <CompanyLogo
        companyName={row.company.name}
        domain={row.company.domain}
        logoUrl={row.company.logo_url}
        className="h-9 w-9 shrink-0 rounded-md"
        priority={priority}
      />
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-900 group-hover:underline">
          {row.company.name}
        </div>
        <div className="truncate text-xs text-slate-500">
          {row.company.industry ?? ""}
          {row.flags.is_staffing_firm && (
            <span className="ml-2 rounded border border-slate-200 px-1 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
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
}: {
  rows: LeaderboardRow[]
  layoffSignals?: Map<string, LayoffSignalBase>
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
        No sponsors match these filters.
      </div>
    )
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-lg border border-slate-200 md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-14 px-4 py-3 text-right">#</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3 text-right">Certified (FY2025)</th>
              <th className="px-4 py-3 text-right">Cert. rate</th>
              <th className="px-4 py-3">Workforce</th>
              <th className="px-4 py-3">Top states</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={row.company.id} className="bg-white hover:bg-slate-50/60">
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-400">
                  {row.rank}
                </td>
                <td className="px-4 py-3">
                  <CompanyCell row={row} priority={i < 10} />
                </td>
                <td className="px-4 py-3">
                  <Link href={`${row.profile_url}/scorecard`}>
                    <ScorecardBadge score={row.sponsorship_confidence ?? 0} />
                  </Link>
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">
                  {row.metrics.certified.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {fmtPct(row.metrics.cert_rate)}
                </td>
                <td className="px-4 py-3">
                  {layoffSignals?.get(row.company.id) && (
                    <LayoffSignalBadge signal={layoffSignals.get(row.company.id)!} size="sm" />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {row.metrics.top_states.slice(0, 3).join(", ")}
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
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
          >
            <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-slate-400">
              {row.rank}
            </span>
            <div className="min-w-0 flex-1">
              <CompanyCell row={row} priority={i < 6} />
              <div className="mt-1 flex items-center gap-1.5">
                <Link href={`${row.profile_url}/scorecard`} className="inline-block">
                  <ScorecardBadge score={row.sponsorship_confidence ?? 0} />
                </Link>
                {layoffSignals?.get(row.company.id) &&
                  layoffSignals.get(row.company.id)!.level !== "stable" && (
                    <LayoffSignalBadge signal={layoffSignals.get(row.company.id)!} size="sm" />
                  )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-medium tabular-nums text-slate-900">
                {row.metrics.certified.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500">{fmtPct(row.metrics.cert_rate)}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
