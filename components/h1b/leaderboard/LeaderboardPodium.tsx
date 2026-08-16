import Link from "next/link"
import { ArrowUpRight, Medal } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { ScorecardBadge } from "@/components/h1b/scorecard/ScorecardBadge"
import type { LeaderboardRow } from "@/lib/h1b/leaderboard"

function fmtPct(rate: number | null): string {
  return rate == null ? "—" : `${(rate * 100).toFixed(1)}%`
}

// Podium position → grid order (center = #1). Static literals so Tailwind keeps them.
const ORDER_CLASS = ["sm:order-2", "sm:order-1", "sm:order-3"] as const

const MEDAL: Record<number, { ring: string; text: string; label: string }> = {
  1: { ring: "ring-amber-400/40", text: "text-amber-700", label: "Gold" },
  2: { ring: "ring-slate-400/40", text: "text-slate-500", label: "Silver" },
  3: { ring: "ring-orange-400/40", text: "text-orange-700", label: "Bronze" },
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wider text-[#ccd6cf]/45">
        {label}
      </div>
      <div
        className={
          "mt-1 truncate text-sm font-semibold tabular-nums " +
          (accent ? "text-[#f5a623]" : "text-white")
        }
      >
        {value}
      </div>
    </div>
  )
}

function PodiumCard({
  row,
  position,
  priority,
}: {
  row: LeaderboardRow
  position: number
  priority?: boolean
}) {
  const featured = position === 1
  const medal = MEDAL[position]

  return (
    <div
      className={
        "relative flex flex-col border p-5 transition-transform duration-300 " +
        (featured
          ? "border-[#f5a623]/40 bg-[#f5a623]/[0.06] sm:-translate-y-3"
          : "border-[rgba(120,200,160,0.2)] bg-[#0e1411] hover:border-[#38e08a]")
      }
    >
      <div className="flex items-start gap-3">
        <CompanyLogo
          companyName={row.company.name}
          domain={row.company.domain}
          logoUrl={row.company.logo_url}
          className={"h-12 w-12 shrink-0 bg-[#0a0e0c] ring-1 " + medal.ring}
          priority={priority}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={row.profile_url}
            className="block truncate font-semibold text-white hover:text-[#38e08a]"
          >
            {row.company.name}
          </Link>
          <div className="truncate text-xs text-[#ccd6cf]/45">
            {row.company.industry ?? "—"}
          </div>
        </div>
        <span
          className={
            "inline-flex items-center gap-1 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-2 py-1 text-[11px] font-semibold " +
            medal.text
          }
        >
          <Medal className="h-3.5 w-3.5" aria-hidden />#{position}
        </span>
      </div>

      <div className="my-4 h-px bg-[rgba(120,200,160,0.12)]" />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Certified" value={row.metrics.certified.toLocaleString()} />
        <Stat label="Cert. rate" value={fmtPct(row.metrics.cert_rate)} accent />
        <Stat label="Filings" value={row.metrics.total_filings.toLocaleString()} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Link href={`${row.profile_url}/scorecard`}>
          <ScorecardBadge score={row.sponsorship_confidence ?? 0} />
        </Link>
        <Link
          href={row.profile_url}
          className="inline-flex items-center gap-1 border border-[rgba(120,200,160,0.2)] px-3 py-1.5 text-xs font-medium text-[#ccd6cf]/70 transition-colors hover:border-[#38e08a] hover:text-[#38e08a]"
        >
          View
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

// Top-3 "podium" cards shown above the leaderboard table (page 1 only). Mirrors the
// hero cards on the reference design: featured #1 raised in the centre on desktop,
// #2 left and #3 right, stacked 1→2→3 on mobile.
export default function LeaderboardPodium({ rows }: { rows: LeaderboardRow[] }) {
  const top = rows.slice(0, 3)
  if (top.length === 0) return null

  return (
    <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
      {top.map((row, i) => (
        <div key={row.company.id} className={ORDER_CLASS[i]}>
          <PodiumCard row={row} position={i + 1} priority={i < 3} />
        </div>
      ))}
    </div>
  )
}
