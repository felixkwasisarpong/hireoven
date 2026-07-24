import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Admin funnel for the /find ad landing page. Lives under the (admin) group, so
// it inherits the admin auth guard. Reads first-party funnel_events; run
// scripts/migrations/add-funnel-events.sql first.

const STEPS = [
  { name: "find_landing_view", label: "Landing viewed" },
  { name: "find_role_submitted", label: "Role submitted" },
  { name: "find_matches_shown", label: "Matches shown" },
  { name: "find_signup_clicked", label: "Signup clicked" },
] as const

type Counts = Map<string, { visitors: number; events: number }>

async function getCounts(days: number): Promise<Counts | "missing" | null> {
  if (!hasPostgresEnv()) return null
  try {
    const { rows } = await getPostgresPool().query<{
      name: string
      visitors: string
      events: string
    }>(
      `SELECT name, COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS events
       FROM funnel_events
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY name`,
      [String(days)],
    )
    return new Map(
      rows.map((r) => [r.name, { visitors: Number(r.visitors), events: Number(r.events) }]),
    )
  } catch {
    return "missing"
  }
}

function pct(n: number, d: number): string {
  if (!d) return "—"
  return `${Math.round((n / d) * 1000) / 10}%`
}

type Daily = { day: string; count: number }

async function getDaily(days: number): Promise<Daily[] | null> {
  if (!hasPostgresEnv()) return null
  try {
    const { rows } = await getPostgresPool().query<{ day: string; count: string }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              COUNT(DISTINCT visitor_id) AS count
       FROM funnel_events
       WHERE name = 'find_role_submitted'
         AND created_at >= now() - ($1 || ' days')::interval
       GROUP BY 1
       ORDER BY 1`,
      [String(days)],
    )
    const map = new Map(rows.map((r) => [r.day, Number(r.count)]))
    // Fill gaps so the axis is continuous.
    const out: Daily[] = []
    const now = Date.now()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
      out.push({ day: d, count: map.get(d) ?? 0 })
    }
    return out
  } catch {
    return null
  }
}

// Self-contained inline bar chart (no chart lib) — engaged visitors per day.
function TrendChart({ data }: { data: Daily[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const W = 560
  const H = 120
  const gap = 4
  const bw = (W - gap * (data.length - 1)) / data.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} className="mt-3 w-full" role="img" aria-label="Daily engaged visitors">
      {data.map((d, i) => {
        const h = Math.round((d.count / max) * H)
        const x = i * (bw + gap)
        return (
          <g key={d.day}>
            <rect x={x} y={H - h} width={bw} height={h} rx={3} className="fill-orange-500" />
            {d.count > 0 && (
              <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                {d.count}
              </text>
            )}
            {i % 2 === 0 && (
              <text x={x + bw / 2} y={H + 14} textAnchor="middle" className="fill-muted-foreground text-[8px]">
                {d.day.slice(5)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default async function FunnelPage() {
  const days = 7
  const [data, daily] = await Promise.all([getCounts(days), getDaily(14)])

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-bold">/find conversion funnel</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        First-party events, last {days} days. Unique visitors per step.
      </p>

      {data === null && (
        <p className="mt-6 rounded-lg border border-border bg-card p-4 text-sm">
          Postgres is not configured in this environment.
        </p>
      )}

      {data === "missing" && (
        <p className="mt-6 rounded-lg border border-border bg-card p-4 text-sm">
          The <code>funnel_events</code> table doesn’t exist yet. Run{" "}
          <code>scripts/migrations/add-funnel-events.sql</code>, then reload.
        </p>
      )}

      {data instanceof Map &&
        (() => {
          const top = data.get(STEPS[0].name)?.visitors ?? 0
          return (
            <div className="mt-6 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Step</th>
                    <th className="px-4 py-3 text-right">Visitors</th>
                    <th className="px-4 py-3 text-right">% of landing</th>
                    <th className="px-4 py-3 text-right">Step drop</th>
                  </tr>
                </thead>
                <tbody>
                  {STEPS.map((s, i) => {
                    const cur = data.get(s.name)?.visitors ?? 0
                    const prev = i === 0 ? cur : data.get(STEPS[i - 1].name)?.visitors ?? 0
                    return (
                      <tr key={s.name} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">{s.label}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{cur.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{pct(cur, top)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {i === 0 ? "—" : pct(cur, prev)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}

      {daily && daily.some((d) => d.count > 0) && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold">Engaged visitors / day (last 14 days)</h2>
          <p className="text-xs text-muted-foreground">Unique visitors who submitted a role on /find.</p>
          <TrendChart data={daily} />
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Signup <em>completions</em> now fire Meta CAPI server-side from the signup routes
        (CompleteRegistration) — reconcile these against ad spend in Meta Events Manager.
      </p>
    </div>
  )
}
