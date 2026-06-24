import Link from "next/link"
import { Trophy } from "lucide-react"
import type { CompanyH1bRank } from "@/lib/h1b/leaderboard"

// Compact "#N H-1B sponsor" badge. Reused on the public company sponsor page and
// (optionally) anywhere a company's leaderboard standing should be surfaced.
export default function RankBadge({ rank }: { rank: CompanyH1bRank }) {
  if (rank.rank_volume == null) return null
  const industryHref = rank.industry
    ? `/h1b-sponsors/leaderboard/by-industry/${encodeURIComponent(
        rank.industry.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      )}`
    : "/h1b-sponsors/leaderboard"

  return (
    <div className="inline-flex flex-wrap items-center gap-2 text-sm">
      <Link
        href="/h1b-sponsors/leaderboard"
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-900 hover:bg-amber-100"
      >
        <Trophy className="h-3.5 w-3.5" />
        #{rank.rank_volume.toLocaleString()} H-1B sponsor
      </Link>
      {rank.rank_in_industry != null && rank.industry && (
        <Link
          href={industryHref}
          className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50"
        >
          #{rank.rank_in_industry.toLocaleString()} in {rank.industry}
        </Link>
      )}
    </div>
  )
}
