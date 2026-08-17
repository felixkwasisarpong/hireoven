"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import type { LevelGap } from "@/lib/stay/level-gap"
import { negotiationLine } from "@/lib/stay/level-gap"
import { WAGE_LEVEL_META, type WageLevel } from "@/lib/stay/lottery-odds"

const LEVEL_TONE: Record<WageLevel, string> = {
  1: "var(--term-danger)",
  2: "var(--term-amber-text)",
  3: "var(--term-green)",
  4: "var(--term-green)",
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

/**
 * The Level Gap card: the exact DOL prevailing-wage ladder for THIS occupation at THIS worksite,
 * and what the next rung is worth under the wage-weighted H-1B lottery (Level I = 1 entry ...
 * Level IV = 4). Thresholds are the published OFLC figures, not an estimate.
 *
 * Client-side only for the copy button — everything shown is computed on the server.
 */
export default function LevelGapCard({
  gap,
  levels,
  areaName,
  socCode,
  socLabel,
  wageYear,
}: {
  gap: LevelGap
  levels: readonly [number, number, number, number]
  areaName: string
  socCode: string
  socLabel?: string | null
  wageYear: string
}) {
  const [copied, setCopied] = useState(false)
  const line = negotiationLine(gap, socLabel)

  const copy = async () => {
    if (!line) return
    try {
      await navigator.clipboard.writeText(line)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure context / permission) — the line is on screen and selectable.
    }
  }

  const currentColor = LEVEL_TONE[gap.currentLevel]

  return (
    <div className="term-panel mt-4 p-5">
      <div className="flex items-start justify-between gap-3 border-b border-[rgba(120,200,160,0.12)] pb-4">
        <div>
          <p className="term-label">H-1B wage level</p>
          <p className="mt-0.5 text-[13px] text-[#ccd6cf]/60">
            the lottery is wage-weighted — each level is one more entry
          </p>
        </div>
        <span
          className="shrink-0 border px-2 py-1 text-[11px] font-semibold"
          style={{
            color: currentColor,
            borderColor: `color-mix(in srgb, ${currentColor} 40%, transparent)`,
            background: `color-mix(in srgb, ${currentColor} 9%, transparent)`,
          }}
        >
          {WAGE_LEVEL_META[gap.currentLevel].label} · {WAGE_LEVEL_META[gap.currentLevel].entryWeight}×
        </span>
      </div>

      {/* The published ladder. The row the posted floor sits on is highlighted. */}
      <div className="mt-4 flex flex-col gap-1.5">
        {([1, 2, 3, 4] as WageLevel[]).map((lvl) => {
          const threshold = levels[lvl - 1]
          const isCurrent = lvl === gap.currentLevel
          const reachable = lvl <= gap.bestLevelInBand
          return (
            <div
              key={lvl}
              className="grid grid-cols-[70px_1fr_auto] items-center gap-3 px-2 py-1.5 text-[13px]"
              style={
                isCurrent
                  ? {
                      background: `color-mix(in srgb, ${currentColor} 8%, transparent)`,
                      borderLeft: `2px solid ${currentColor}`,
                    }
                  : { borderLeft: "2px solid transparent" }
              }
            >
              <span className={reachable ? "text-[#ccd6cf]/85" : "text-[#ccd6cf]/35"}>
                {WAGE_LEVEL_META[lvl].label}
              </span>
              <span className={`tabular-nums ${reachable ? "text-white" : "text-[#ccd6cf]/35"}`}>
                {usd(threshold)}
              </span>
              <span className={`text-[11px] ${reachable ? "text-[#ccd6cf]/60" : "text-[#ccd6cf]/30"}`}>
                {WAGE_LEVEL_META[lvl].entryWeight} {WAGE_LEVEL_META[lvl].entryWeight === 1 ? "entry" : "entries"}
              </span>
            </div>
          )
        })}
      </div>

      {/* The actionable line. */}
      <div className="mt-4 border-t border-[rgba(120,200,160,0.12)] pt-4 text-[13px] leading-relaxed">
        {gap.belowPrevailingWage ? (
          <p className="text-[#ccd6cf]/75">
            The bottom of this range ({usd(gap.anchorSalary)}) is <strong className="text-white">below the
            Level I prevailing wage</strong> of {usd(levels[0])}. An H-1B cannot be filed below the prevailing
            wage, so an offer at the floor of this band could not be sponsored as posted.
          </p>
        ) : gap.ceilingBelowLevelTwo ? (
          <p className="text-[#ccd6cf]/75">
            Even the top of this range is below the Level II threshold of {usd(levels[1])}, so this role stays at{" "}
            <strong className="text-white">one lottery entry</strong> however you negotiate. That is a property of
            the posted band, not of you.
          </p>
        ) : gap.nextLevel && gap.increaseNeeded !== null && gap.nextLevelWithinBand ? (
          <p className="text-[#ccd6cf]/75">
            <strong className="text-white">{usd(gap.increaseNeeded)} more</strong> — {usd(gap.nextThreshold ?? 0)} —
            moves this role to {WAGE_LEVEL_META[gap.nextLevel].label} and{" "}
            <strong className="text-white">
              {WAGE_LEVEL_META[gap.nextLevel].entryWeight} lottery entries
            </strong>
            . That figure is inside the range the employer already advertised.
          </p>
        ) : gap.nextLevel && gap.increaseNeeded !== null ? (
          <p className="text-[#ccd6cf]/75">
            {WAGE_LEVEL_META[gap.nextLevel].label} starts at {usd(gap.nextThreshold ?? 0)} —{" "}
            {usd(gap.increaseNeeded)} above the bottom of this range, and above its posted ceiling.
          </p>
        ) : (
          <p className="text-[#ccd6cf]/75">
            This range already reaches <strong className="text-white">Level IV</strong> — the maximum four lottery
            entries.
          </p>
        )}

        {line && (
          <div className="mt-3 border border-[rgba(120,200,160,0.18)] bg-[#0a0e0c] p-3">
            <p className="text-[12px] italic text-[#ccd6cf]/70">{line}</p>
            <button
              type="button"
              onClick={copy}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--term-green)] hover:underline"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy negotiation line"}
            </button>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[#ccd6cf]/40">
        DOL prevailing wage, {wageYear} wage year · {socLabel ? `${socLabel} (${socCode})` : socCode}
        {areaName ? ` · ${areaName}` : ""}. Wage level is derived by USCIS from the offered wage, occupation and
        worksite; the occupation shown is inferred from the job title.
      </p>
    </div>
  )
}
