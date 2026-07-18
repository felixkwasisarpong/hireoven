import Link from "next/link"
import { MapPin, Banknote } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { salaryLabel, freshnessLabel, type PublicJobRow } from "@/lib/jobs/format"

/**
 * Ordered list of public job rows for the SEO landing pages. Each row links to
 * the job detail page and shows company, location/remote, salary, and freshness.
 */
export default function PublicJobList({ jobs }: { jobs: PublicJobRow[] }) {
  return (
    <ol className="mt-8 space-y-2">
      {jobs.map((j) => {
        const sal = salaryLabel(j)
        return (
          <li key={j.id}>
            <Link
              href={`/jobs/${j.id}`}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 transition hover:border-sky-200 hover:shadow-sm"
            >
              {j.company_name && (
                <CompanyLogo
                  companyName={j.company_name}
                  domain={j.company_domain ?? null}
                  logoUrl={j.company_logo_url ?? null}
                  className="h-10 w-10 shrink-0 rounded-xl border border-slate-200/70 bg-white"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900">{j.title}</p>
                  <span className="shrink-0 text-[12px] text-slate-400">{freshnessLabel(j.first_detected_at)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
                  {j.company_name && <span className="truncate font-medium text-slate-600">{j.company_name}</span>}
                  {(j.is_remote || j.location) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {j.is_remote ? "Remote" : j.location}
                    </span>
                  )}
                  {sal && (
                    <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                      <Banknote className="h-3.5 w-3.5" />
                      {sal}
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
