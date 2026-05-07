import { cn } from "@/lib/utils"

type VoiceMetrics = {
  filler_words_per_min: number
  filler_word_breakdown: Record<string, number>
  pace_wpm: number
  hedge_count: number
  hedge_per_min: number
  hedge_breakdown: Record<string, number>
  silence_ratio: number
  longest_pause_sec: number
  avg_response_latency_sec: number
  comment: string
}

function fillerColor(fpm: number) {
  if (fpm > 6) return "text-red-600 bg-red-50"
  if (fpm > 4) return "text-amber-600 bg-amber-50"
  return "text-emerald-600 bg-emerald-50"
}

function paceColor(wpm: number) {
  if (wpm > 175 || wpm < 110) return "text-red-600 bg-red-50"
  if (wpm > 160 || wpm < 120) return "text-amber-600 bg-amber-50"
  return "text-emerald-600 bg-emerald-50"
}

function MetricTile({ value, label, colorCls }: { value: string; label: string; colorCls: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-xl px-4 py-3 text-center", colorCls)}>
      <span className="text-[18px] font-bold tabular-nums">{value}</span>
      <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
    </div>
  )
}

function topBreakdown(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `"${k}" (${v})`)
    .join(", ")
}

export default function DebriefVoicePanel({ metrics }: { metrics: VoiceMetrics | null }) {
  if (!metrics) {
    return (
      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-purple-600">Voice feedback</h2>
        <div className="rounded-2xl border border-purple-100 bg-purple-50/40 p-5">
          <p className="text-[13px] text-slate-500">
            Voice metrics are computed from live session transcripts and will appear here after your next live interview.
          </p>
        </div>
      </section>
    )
  }

  const fillerTop = topBreakdown(metrics.filler_word_breakdown)
  const hedgeTop = topBreakdown(metrics.hedge_breakdown)

  return (
    <section>
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-purple-600">Voice feedback</h2>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        {/* Metric tiles */}
        <div className="grid grid-cols-3 gap-3">
          <MetricTile
            value={`${metrics.filler_words_per_min}/min`}
            label="Fillers"
            colorCls={fillerColor(metrics.filler_words_per_min)}
          />
          <MetricTile
            value={`${metrics.pace_wpm} wpm`}
            label="Pace"
            colorCls={paceColor(metrics.pace_wpm)}
          />
          <MetricTile
            value={`${Math.round(metrics.silence_ratio * 100)}%`}
            label="Silence"
            colorCls="text-slate-600 bg-slate-50"
          />
        </div>

        {/* Breakdowns */}
        {fillerTop && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Top fillers</p>
            <p className="text-[13px] text-slate-700">{fillerTop}</p>
          </div>
        )}
        {hedgeTop && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Top hedges</p>
            <p className="text-[13px] text-slate-700">{hedgeTop}</p>
          </div>
        )}

        {/* Comment */}
        {metrics.comment && (
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-[13px] leading-relaxed text-slate-700">{metrics.comment}</p>
          </div>
        )}
      </div>
    </section>
  )
}
