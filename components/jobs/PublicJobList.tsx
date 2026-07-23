import Link from "next/link"
import { MapPin, Banknote } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { salaryLabel, freshnessLabel, type PublicJobRow } from "@/lib/jobs/format"
import { estimateWageLevel, WAGE_LEVEL_META } from "@/lib/stay/lottery-odds"

/** Salary-only H-1B lottery chip — the wage level and single-draw odds a role's
 *  pay implies under the 2026 weighted lottery. (The full Stay Score, which also
 *  needs the employer's sponsorship signals, lives on the job detail page.) */
function lotteryChip(j: PublicJobRow) {
  const salary =
    j.salary_min && j.salary_max ? Math.round((j.salary_min + j.salary_max) / 2) : j.salary_max ?? j.salary_min ?? null
  const est = estimateWageLevel({ salary })
  if (!est) return null
  const oddsPct = Math.round(est.meta.singleDrawOdds * 100)
  const color = oddsPct < 20 ? "#e5695f" : oddsPct < 40 ? "#f5a623" : "#38e08a"
  return { label: WAGE_LEVEL_META[est.level].label, oddsPct, color }
}

/**
 * Ordered list of public job rows for the SEO landing pages. Each row links to
 * the job detail page and shows company, location/remote, salary, freshness, and
 * a Stay lottery-level chip. Terminal / data-desk styling.
 */
export default function PublicJobList({ jobs }: { jobs: PublicJobRow[] }) {
  return (
    <ol className="mt-8 space-y-2">
      {jobs.map((j) => {
        const sal = salaryLabel(j)
        const chip = lotteryChip(j)
        return (
          <li key={j.id}>
            <Link href={`/jobs/${j.id}`} className="term-panel term-panel-hover flex items-start gap-3 px-4 py-3.5">
              {j.company_name && (
                <CompanyLogo
                  companyName={j.company_name}
                  domain={j.company_domain ?? null}
                  logoUrl={j.company_logo_url ?? null}
                  className="h-10 w-10 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{j.title}</p>
                  <span className="shrink-0 text-[12px] text-[#6c7a72]">{freshnessLabel(j.first_detected_at)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[#ccd6cf]/55">
                  {j.company_name && <span className="truncate font-medium text-[#ccd6cf]/70">{j.company_name}</span>}
                  {(j.is_remote || j.location) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {j.is_remote ? "Remote" : j.location}
                    </span>
                  )}
                  {sal && (
                    <span className="inline-flex items-center gap-1 font-medium tabular-nums text-[#38e08a]">
                      <Banknote className="h-3.5 w-3.5" />
                      {sal}
                    </span>
                  )}
                  {chip && (
                    <span
                      className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                      style={{ color: chip.color, borderColor: chip.color + "55", background: chip.color + "14" }}
                      title="Estimated H-1B wage level and single-draw lottery odds under the 2026 weighted rule"
                    >
                      H-1B {chip.label} · {chip.oddsPct}%
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
