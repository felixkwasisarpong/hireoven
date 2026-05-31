"use client"

import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoutGraphItemColor = "orange" | "blue" | "green" | "amber" | "red" | "slate"

export type ScoutGraphItem = {
  label:    string
  value:    number
  /** For bar/score charts: the scale maximum. Defaults to 100. */
  maxValue?: number
  color?:   ScoutGraphItemColor
  /** Optional sub-label / secondary value */
  sublabel?: string
}

export type ScoutGraphType =
  | "bar"             // horizontal percentage bars
  | "comparison"      // side-by-side bars (two series)
  | "score_breakdown" // labeled score bars with value annotation
  | "market_signal"   // compact signal rows with colored severity dots

export type ScoutGraph = {
  type:  ScoutGraphType
  title: string
  items: ScoutGraphItem[]
  /** Unit appended to values e.g. "%" | " jobs" | "k" */
  unit?: string
}

// ── Color maps ────────────────────────────────────────────────────────────────

const COLOR_BAR: Record<ScoutGraphItemColor, string> = {
  orange: "bg-[#FF5C18]",
  blue:   "bg-blue-500",
  green:  "bg-emerald-500",
  amber:  "bg-amber-400",
  red:    "bg-red-500",
  slate:  "bg-slate-400",
}
const COLOR_TEXT: Record<ScoutGraphItemColor, string> = {
  orange: "text-[#FF5C18]",
  blue:   "text-blue-600",
  green:  "text-emerald-600",
  amber:  "text-amber-600",
  red:    "text-red-600",
  slate:  "text-slate-500",
}
const COLOR_DOT: Record<ScoutGraphItemColor, string> = {
  orange: "bg-[#FF5C18]",
  blue:   "bg-blue-500",
  green:  "bg-emerald-500",
  amber:  "bg-amber-400",
  red:    "bg-red-500",
  slate:  "bg-slate-400",
}

function defaultColor(index: number): ScoutGraphItemColor {
  const palette: ScoutGraphItemColor[] = ["orange", "blue", "green", "amber", "slate"]
  return palette[index % palette.length]
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function BarChart({ items, unit = "%" }: { items: ScoutGraphItem[]; unit?: string }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => {
        const color = item.color ?? defaultColor(i)
        const max   = item.maxValue ?? 100
        const pct   = Math.min(100, Math.max(0, (item.value / max) * 100))
        return (
          <li key={item.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700">{item.label}</span>
              <span className={cn("font-semibold tabular-nums", COLOR_TEXT[color])}>
                {item.value}{unit}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all duration-500", COLOR_BAR[color])}
                style={{ width: `${pct}%` }}
              />
            </div>
            {item.sublabel && (
              <p className="mt-0.5 text-[10px] text-slate-400">{item.sublabel}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── Score breakdown ───────────────────────────────────────────────────────────

function ScoreBreakdown({ items, unit = "%" }: { items: ScoutGraphItem[]; unit?: string }) {
  return (
    <ul className="divide-y divide-slate-50">
      {items.map((item, i) => {
        const color = item.color ?? defaultColor(i)
        const max   = item.maxValue ?? 100
        const pct   = Math.min(100, Math.max(0, (item.value / max) * 100))
        return (
          <li key={item.label} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span className="w-28 flex-shrink-0 text-[11px] text-slate-500 truncate">{item.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all duration-500", COLOR_BAR[color])}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={cn("w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums", COLOR_TEXT[color])}>
              {item.value}{unit}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ── Market signal list ────────────────────────────────────────────────────────

function MarketSignalList({ items }: { items: ScoutGraphItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => {
        const color = item.color ?? defaultColor(i)
        return (
          <li key={item.label} className="flex items-start gap-2.5">
            <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", COLOR_DOT[color])} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-700">{item.label}</p>
              {item.sublabel && (
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.sublabel}</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ── Comparison chart ──────────────────────────────────────────────────────────

function ComparisonChart({ items, unit = "%" }: { items: ScoutGraphItem[]; unit?: string }) {
  const maxVal = Math.max(...items.map((i) => i.maxValue ?? i.value), 1)
  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const color = item.color ?? defaultColor(i)
        const pct   = Math.min(100, (item.value / maxVal) * 100)
        return (
          <li key={item.label} className="flex items-center gap-3">
            <span className="w-24 flex-shrink-0 text-xs font-medium text-slate-600 truncate text-right">
              {item.label}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
              <div
                className={cn(
                  "flex h-full items-center justify-end pr-1.5 rounded-md transition-all duration-500",
                  COLOR_BAR[color]
                )}
                style={{ width: `${pct}%` }}
              >
                <span className="text-[9px] font-bold text-white tabular-nums">
                  {item.value}{unit}
                </span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ── Main renderer ─────────────────────────────────────────────────────────────

type Props = {
  graph:    ScoutGraph
  compact?: boolean
}

export function ScoutGraphRenderer({ graph, compact = false }: Props) {
  if (!graph.items.length) return null

  return (
    <div className={cn("rounded-xl border border-slate-100 bg-slate-50/60", compact ? "mt-3 p-3" : "mt-4 p-4")}>
      {graph.title && (
        <p className={cn("font-semibold text-slate-700 mb-3", compact ? "text-xs" : "text-sm")}>
          {graph.title}
        </p>
      )}

      {graph.type === "bar"             && <BarChart          items={graph.items} unit={graph.unit} />}
      {graph.type === "score_breakdown" && <ScoreBreakdown    items={graph.items} unit={graph.unit} />}
      {graph.type === "comparison"      && <ComparisonChart   items={graph.items} unit={graph.unit} />}
      {graph.type === "market_signal"   && <MarketSignalList  items={graph.items} />}
    </div>
  )
}
