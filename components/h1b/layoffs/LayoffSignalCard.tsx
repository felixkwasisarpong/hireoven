import Link from "next/link"
import type { LayoffSignal } from "@/lib/h1b/layoff-signal"
import { LayoffSignalBadge } from "./LayoffSignalBadge"

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Calm, informational workforce-signal block for the company profile + scorecard pages.
// No alarmist copy; sources collapsed by default for users who want to verify.
export function LayoffSignalCard({ signal }: { signal: LayoffSignal }) {
  const ev = signal.evidence
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-900">Workforce signal</h3>
        <LayoffSignalBadge signal={signal} />
      </div>

      <p className="text-sm text-slate-600">{signal.one_liner}</p>

      {ev.most_recent_event && (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Most recent event</dt>
            <dd className="text-slate-800">
              {fmtDate(ev.most_recent_event.date)}
              {ev.most_recent_event.size != null && (
                <span className="text-slate-500">
                  {" "}
                  · {ev.most_recent_event.size.toLocaleString()} workers
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Workers affected (12 mo)</dt>
            <dd className="text-slate-800">{ev.workers_affected_12mo.toLocaleString()}</dd>
          </div>
        </dl>
      )}

      {signal.source_refs.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">
            Sources ({signal.source_refs.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {signal.source_refs.map((ref, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-400">{ref.kind}</span>
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-700 hover:underline"
                  >
                    {ref.title}
                  </a>
                ) : (
                  <span className="text-slate-700">{ref.title}</span>
                )}
                <span className="ml-auto text-xs text-slate-400">{fmtDate(ref.date)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Based on public DOL WARN filings and reported layoff events.{" "}
        <Link href="/h1b-sponsors/leaderboard/methodology#layoffs" className="underline">
          How we measure this
        </Link>
        .
      </p>
    </section>
  )
}
