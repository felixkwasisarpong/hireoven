import Link from "next/link"
import type { StayScoreResult, StayTone } from "@/lib/stay/stay-score"

const TONE_COLOR: Record<StayTone, string> = {
  good: "var(--term-green)",
  warn: "var(--term-amber-text)",
  crit: "var(--term-danger)",
  brand: "var(--term-info)",
  neutral: "var(--term-dim)",
}

/**
 * Presentational Stay Score readout — server-renderable. Shows the 0–100 survival
 * score, its transparent breakdown, and the verdict. Used on job/company pages so
 * the Stay Score is a real product surface, not just the /stay demo.
 */
export default function StayScorePanel({
  result,
  personalizeHref = "/stay/timeline",
}: {
  result: StayScoreResult
  personalizeHref?: string
}) {
  const color = TONE_COLOR[result.badgeTone]
  return (
    <div className="term-panel p-5">
      <div className="flex items-center justify-between gap-3 border-b border-[rgba(120,200,160,0.12)] pb-4">
        <div>
          <p className="term-label">Stay score</p>
          <p className="mt-0.5 text-[13px] text-[#ccd6cf]/60">odds of building a lasting career here</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[34px] font-semibold tabular-nums" style={{ color }}>
            {result.score}
          </span>
          <span
            className="border px-2 py-1 text-[11px] font-semibold"
            style={{
              color,
              borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
              background: `color-mix(in srgb, ${color} 9%, transparent)`,
            }}
          >
            {result.band}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {result.bars.map((b) => (
          <div key={b.key} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] items-center gap-3 text-[13px]">
            <span className="text-[#ccd6cf]/70">{b.key}</span>
            <span className="h-2 overflow-hidden bg-[#0e1411]">
              <span className="block h-2" style={{ width: `${b.value}%`, background: TONE_COLOR[b.tone] }} />
            </span>
            <span className="w-9 text-right tabular-nums text-[#ccd6cf]/70">{b.value}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-3 text-[13px] leading-relaxed text-[#ccd6cf]/80">
        {result.verdict}
      </p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--term-dim)]">Lottery odds assume a STEM candidate.</p>
        <Link
          href={personalizeHref}
          className="text-[12px] font-semibold text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
        >
          Personalize to your clock →
        </Link>
      </div>
    </div>
  )
}
