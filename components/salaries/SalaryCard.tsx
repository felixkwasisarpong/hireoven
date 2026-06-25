import Link from "next/link"
import type { WageAggregate } from "@/lib/salaries/wage-query"

export function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}
export function fmtUsdK(n: number): string {
  return `$${Math.round(n / 1000)}k`
}

function RangeBar({ a }: { a: WageAggregate }) {
  const span = Math.max(1, a.max - a.min)
  const left = ((a.p25 - a.min) / span) * 100
  const width = ((a.p75 - a.p25) / span) * 100
  const mid = ((a.p50 - a.min) / span) * 100
  return (
    <div className="mt-4">
      <div className="relative h-2 w-full rounded-full bg-slate-100">
        <div
          className="absolute h-full rounded-full bg-emerald-200"
          style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-emerald-600"
          style={{ left: `${mid}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{fmtUsdK(a.p25)} (p25)</span>
        <span>{fmtUsdK(a.p75)} (p75)</span>
      </div>
    </div>
  )
}

// `broaderHref` is the one-click "fewer filters" escape so insufficient data never dead-ends.
export function SalaryCard({
  title,
  subtitle,
  aggregate,
  broaderHref,
  broaderLabel,
}: {
  title: string
  subtitle: string
  aggregate: WageAggregate | null
  broaderHref?: string
  broaderLabel?: string
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <p className="text-sm text-slate-500">{subtitle}</p>
      <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>

      {aggregate ? (
        <>
          <div className="mt-5 flex items-end gap-3">
            <div className="text-5xl font-black tabular-nums text-emerald-700">
              {fmtUsd(aggregate.p50)}
            </div>
            <div className="pb-1 text-sm text-slate-500">
              median · n={aggregate.n.toLocaleString()}
            </div>
          </div>
          <RangeBar a={aggregate} />
          <p className="mt-4 text-xs text-slate-400">
            Median prevailing wage from {aggregate.n.toLocaleString()} certified LCA filings, FY
            {aggregate.fy_range.min}–FY{aggregate.fy_range.max}. Prevailing wage is the wage the
            employer files, not necessarily what is paid; excludes bonus and equity.
          </p>
        </>
      ) : (
        <div className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
          <p>We don&rsquo;t have enough public filings (fewer than 5) to estimate this reliably.</p>
          {broaderHref && (
            <Link href={broaderHref} className="mt-2 inline-block font-medium text-slate-800 underline">
              {broaderLabel ?? "Show data with fewer filters →"}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
