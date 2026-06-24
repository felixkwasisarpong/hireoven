import Link from "next/link"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { scoreBucket } from "@/lib/h1b/scorecard"
import { ScoreNumber } from "./ScoreNumber"
import type { ScorecardPayload } from "@/types/h1b-scorecard"

export function ScorecardHero({ data }: { data: ScorecardPayload }) {
  const b = scoreBucket(data.score)
  return (
    <header>
      <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
        <Link href="/h1b-sponsors/leaderboard" className="hover:text-slate-800">
          All sponsors
        </Link>
        <span className="text-slate-300">/</span>
        <Link href={data.profile_url} className="hover:text-slate-800">
          {data.company.name}
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700">Scorecard</span>
      </nav>

      <div className="flex items-center gap-4">
        <CompanyLogo
          companyName={data.company.name}
          domain={data.company.domain}
          logoUrl={data.company.logo_url}
          priority
          className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200/70 bg-white"
        />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {data.company.name} H-1B Scorecard
          </h1>
          {data.company.industry && (
            <p className="text-sm text-slate-500">{data.company.industry}</p>
          )}
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <ScoreNumber score={data.score} />
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-600">
          {b.description}
        </p>
      </div>
    </header>
  )
}
