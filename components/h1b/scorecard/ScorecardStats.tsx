import type { ScorecardPayload } from "@/types/h1b-scorecard"

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
    </div>
  )
}

export function ScorecardStats({ data }: { data: ScorecardPayload }) {
  const m = data.metrics
  const stats: Array<{ label: string; value: string }> = [
    { label: "Total LCA filings", value: m.total_filings.toLocaleString() },
    {
      label: m.latest_fy > 0 ? `Certified FY${m.latest_fy}` : "Certified",
      value: m.certified_latest_fy.toLocaleString(),
    },
    { label: "Certification rate", value: `${(m.cert_rate * 100).toFixed(1)}%` },
  ]
  if (data.rank.overall != null) {
    stats.push({ label: "National rank", value: `#${data.rank.overall.toLocaleString()}` })
  }
  if (data.rank.in_industry != null && data.rank.industry) {
    stats.push({ label: `Rank in ${data.rank.industry}`, value: `#${data.rank.in_industry}` })
  }

  return (
    <section className="mt-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Stat key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {(m.top_states.length > 0 || m.top_titles.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {m.top_states.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Top worksite states
              </div>
              <div className="mt-1 text-sm text-slate-700">
                {m.top_states.slice(0, 6).join(", ")}
              </div>
            </div>
          )}
          {m.top_titles.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Top sponsored roles
              </div>
              <div className="mt-1 text-sm text-slate-700">
                {m.top_titles.slice(0, 4).join(", ")}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
