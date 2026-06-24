// Categorical layoff/hiring-freeze signal derived from already-public data
// (DOL WARN filings + reported events in layoff_events / company_layoff_summary).
//
// Deliberately NOT a 0-100 score: the underlying data is qualitative and varies in
// confidence (legally-binding WARN vs reported events), so a pseudo-precise number
// would overstate certainty. Four labelled tiers, calm/informational tone.

export type LayoffLevel = "stable" | "watching" | "elevated" | "active"
export type LayoffHue = "slate" | "amber" | "orange" | "red"

// Real DB enum values (company_layoff_summary CHECK constraints).
export type FreezeConfidence = "confirmed" | "likely" | "possible"
export type LayoffTrend = "accelerating" | "stable" | "recovering"

// Display-facing source kind (mapped from layoff_events.source: warn_act / layoffs_fyi / news_signal).
export type LayoffSourceKind = "WARN" | "layoffs.fyi" | "news"

export interface LayoffSignal {
  level: LayoffLevel
  label: string
  short: string
  hue: LayoffHue
  one_liner: string
  evidence: {
    events_12mo: number
    workers_affected_12mo: number
    most_recent_event: { date: string; size: number | null; source: LayoffSourceKind } | null
    has_active_freeze: boolean
    freeze_confidence: FreezeConfidence | null
    layoff_trend: LayoffTrend | null
  }
  source_refs: Array<{
    kind: LayoffSourceKind
    title: string
    url: string | null
    date: string
  }>
}

export interface LayoffSignalInput {
  has_active_freeze: boolean
  freeze_confidence: FreezeConfidence | null
  layoff_trend: LayoffTrend | null
  events_12mo: number
  events_90d: number
  workers_affected_12mo: number
}

export type LayoffSignalBase = Pick<
  LayoffSignal,
  "level" | "label" | "short" | "hue" | "one_liner"
>

export function deriveLayoffSignal(input: LayoffSignalInput): LayoffSignalBase {
  const events90 = input.events_90d ?? 0
  const events12 = input.events_12mo ?? 0
  const frozen = input.has_active_freeze ?? false

  // ACTIVE — confirmed freeze, or a layoff event within 90 days.
  if ((frozen && input.freeze_confidence === "confirmed") || events90 >= 1) {
    return {
      level: "active",
      label: "Active Layoffs",
      short: "Active",
      hue: "red",
      one_liner:
        events90 >= 1
          ? `${events90} layoff event${events90 === 1 ? "" : "s"} in the last 90 days`
          : "Confirmed hiring freeze",
    }
  }

  // ELEVATED — likely freeze, 2+ events in 12 months, or an accelerating trend.
  if (
    (frozen && input.freeze_confidence === "likely") ||
    events12 >= 2 ||
    input.layoff_trend === "accelerating"
  ) {
    return {
      level: "elevated",
      label: "Elevated Risk",
      short: "Elevated",
      hue: "orange",
      one_liner:
        events12 >= 2
          ? `${events12} layoff events in the last 12 months`
          : "Hiring freeze likely",
    }
  }

  // WATCHING — possible freeze, or a single event in 12 months.
  if ((frozen && input.freeze_confidence === "possible") || events12 === 1) {
    return {
      level: "watching",
      label: "Recent Layoffs",
      short: "Watching",
      hue: "amber",
      one_liner:
        events12 === 1
          ? "1 layoff event in the last 12 months"
          : "Possible hiring freeze signal",
    }
  }

  // STABLE — no signals. Absence of evidence is not penalised.
  return {
    level: "stable",
    label: "No Recent Layoffs",
    short: "Stable",
    hue: "slate",
    one_liner: "No layoff events reported in the last 12 months",
  }
}

// Map a raw layoff_events.source value to the display kind.
export function layoffSourceKind(source: string | null | undefined): LayoffSourceKind {
  switch (source) {
    case "warn_act":
      return "WARN"
    case "layoffs_fyi":
      return "layoffs.fyi"
    default:
      return "news"
  }
}
