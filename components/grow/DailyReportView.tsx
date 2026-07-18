import Link from "next/link"
import { Flame, Sparkles, Globe2, GraduationCap, Building2, ShieldCheck } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { jobsAtPath } from "@/lib/seo/company-seo"
import type { DailyReport } from "@/lib/grow/daily-report"

function prettyDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

const STAT_META: Array<{
  key: keyof DailyReport["totals"]
  label: string
  Icon: typeof Flame
  accent: string
}> = [
  { key: "newJobs", label: "Fresh jobs", Icon: Flame, accent: "text-slate-900" },
  { key: "aiJobs", label: "AI / ML roles", Icon: Sparkles, accent: "text-emerald-600" },
  { key: "remoteJobs", label: "Remote roles", Icon: Globe2, accent: "text-teal-600" },
  { key: "newGradJobs", label: "New-grad / entry", Icon: GraduationCap, accent: "text-indigo-600" },
  { key: "companiesHiring", label: "Companies hiring", Icon: Building2, accent: "text-slate-900" },
  { key: "sponsorCompanies", label: "With sponsorship history", Icon: ShieldCheck, accent: "text-violet-600" },
]

export default function DailyReportView({
  report,
  prevDate,
  nextDate,
}: {
  report: DailyReport
  prevDate?: string | null
  nextDate?: string | null
}) {
  const { totals } = report

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="max-w-2xl">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <Flame className="h-3.5 w-3.5" /> Fresh Jobs Report
        </span>
        <h1 className="mt-3 text-[30px] font-bold leading-tight tracking-tight text-slate-950 sm:text-[36px]">
          {prettyDate(report.date)}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
          Every listing below was discovered directly from a company career page in the last 24 hours —
          before it hit the crowded job boards. Sponsorship history comes from certified DOL filings.
        </p>
      </header>

      {/* Headline stats */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {STAT_META.map(({ key, label, Icon, accent }) => (
          <div
            key={key}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
          >
            <Icon className={`h-5 w-5 ${accent}`} />
            <p className={`mt-2 text-[26px] font-bold tabular-nums leading-none ${accent}`}>
              {totals[key].toLocaleString("en-US")}
            </p>
            <p className="mt-1.5 text-[12.5px] font-medium leading-tight text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      {/* Top companies */}
      {report.topCompanies.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-bold text-slate-900">Companies posting the most today</h2>
          <ol className="mt-4 space-y-2">
            {report.topCompanies.map((c, i) => (
              <li key={c.id}>
                <Link
                  href={jobsAtPath(c.id, c.name)}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 transition hover:border-emerald-200 hover:shadow-sm sm:px-4"
                >
                  <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-400">
                    {i + 1}
                  </span>
                  <CompanyLogo
                    companyName={c.name}
                    domain={c.domain}
                    logoUrl={c.logoUrl}
                    className="h-10 w-10 shrink-0 rounded-xl border border-slate-200/70 bg-white"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-slate-900">{c.name}</p>
                    <div className="flex items-center gap-2">
                      {c.industry && <p className="truncate text-[12px] text-slate-500">{c.industry}</p>}
                      {c.sponsorsH1b && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                          <ShieldCheck className="h-3 w-3" /> Sponsors H-1B
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[15px] font-bold tabular-nums text-slate-900">
                      {c.jobCount.toLocaleString("en-US")}
                    </p>
                    <p className="text-[10.5px] leading-tight text-slate-400">new roles</p>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Top roles + locations */}
      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        {report.topRoles.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-slate-900">Most-posted roles</h2>
            <ul className="mt-4 space-y-1.5">
              {report.topRoles.map((r) => (
                <li
                  key={r.title}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="truncate text-[13.5px] font-medium text-slate-700">{r.title}</span>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums text-slate-900">
                    {r.count.toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.topLocations.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-slate-900">Top locations</h2>
            <ul className="mt-4 space-y-1.5">
              {report.topLocations.map((l) => (
                <li
                  key={l.location}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="truncate text-[13.5px] font-medium text-slate-700">{l.location}</span>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums text-slate-900">
                    {l.count.toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* CTA */}
      <section className="mt-12 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-6 py-8 text-center">
        <h2 className="text-xl font-bold text-slate-900">Get tomorrow&apos;s fresh jobs first</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] text-slate-600">
          Wake up to the roles posted overnight — filtered to your titles, with H-1B sponsorship intel built in.
        </p>
        <Link
          href="/signup"
          className="mt-5 inline-flex items-center justify-center rounded-full bg-emerald-600 px-6 py-2.5 text-[14px] font-semibold text-white transition hover:bg-emerald-700"
        >
          Start tracking free
        </Link>
        <p className="mt-4 text-[13px] text-slate-500">
          or{" "}
          <Link href="/jobs/browse" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
            browse jobs by role, location &amp; visa
          </Link>
        </p>
      </section>

      {/* Date nav */}
      <nav className="mt-8 flex items-center justify-between text-[13px] font-medium">
        {prevDate ? (
          <Link href={`/report/${prevDate}`} className="text-slate-600 hover:text-emerald-700">
            ← {prettyDate(prevDate)}
          </Link>
        ) : (
          <span />
        )}
        {nextDate ? (
          <Link href={`/report/${nextDate}`} className="text-slate-600 hover:text-emerald-700">
            {prettyDate(nextDate)} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  )
}
