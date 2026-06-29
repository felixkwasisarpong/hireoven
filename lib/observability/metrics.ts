/**
 * Thin in-process metrics. No external dependency — fine for the single-worker
 * setup. Counters and gauges are kept as rolling HOURLY buckets (24 of them) so
 * 24h aggregates stay accurate and bounded regardless of emit volume (the
 * harvester emits jobs.persisted per job). Histograms keep a capped, 24h-pruned
 * sample buffer for percentiles. If we go multi-process, wire emit() to Postgres
 * or an external collector instead.
 *
 * A lazy periodic flush logs the snapshot as structured JSON (for log-based
 * dashboards); the in-memory window powers the admin endpoint.
 */

export type MetricKind = "counter" | "gauge" | "histogram"

export interface MetricEvent {
  kind: MetricKind
  name: string
  value: number
  labels?: Record<string, string | number>
  ts: string // ISO
}

const HOUR_MS = 3_600_000
const WINDOW_MS = 24 * HOUR_MS
const HIST_CAP = 20_000 // per histogram metric
const FLUSH_INTERVAL_MS = 60_000

type Labels = Record<string, string | number>

function labelKey(labels?: Labels): string {
  if (!labels) return ""
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("|")
}

function hourOf(ms: number): number {
  return Math.floor(ms / HOUR_MS)
}

// ── Stores ───────────────────────────────────────────────────────────────────

type CounterSeries = { labels: Labels; buckets: Map<number, number> }
type GaugeSeries = { labels: Labels; ts: number; value: number }
type HistSample = { labels: Labels; value: number; ts: number }

const counters = new Map<string, Map<string, CounterSeries>>()
const gauges = new Map<string, Map<string, GaugeSeries>>()
const histograms = new Map<string, HistSample[]>()

function nowMs(): number {
  return Date.now()
}

function pruneCounter(series: CounterSeries, cutoffHour: number): void {
  for (const h of series.buckets.keys()) {
    if (h < cutoffHour) series.buckets.delete(h)
  }
}

// ── Public emit API ──────────────────────────────────────────────────────────

export function emit(kind: MetricKind, name: string, value: number, labels?: Labels): void {
  ensureFlush()
  const ms = nowMs()
  if (kind === "counter") {
    let series = counters.get(name)
    if (!series) counters.set(name, (series = new Map()))
    const lk = labelKey(labels)
    let s = series.get(lk)
    if (!s) series.set(lk, (s = { labels: labels ?? {}, buckets: new Map() }))
    const h = hourOf(ms)
    s.buckets.set(h, (s.buckets.get(h) ?? 0) + value)
    return
  }
  if (kind === "gauge") {
    let series = gauges.get(name)
    if (!series) gauges.set(name, (series = new Map()))
    const lk = labelKey(labels)
    series.set(lk, { labels: labels ?? {}, ts: ms, value })
    return
  }
  // histogram
  let buf = histograms.get(name)
  if (!buf) histograms.set(name, (buf = []))
  buf.push({ labels: labels ?? {}, value, ts: ms })
  if (buf.length > HIST_CAP) buf.splice(0, buf.length - HIST_CAP)
}

export function counter(name: string, labels?: Labels, value = 1): void {
  emit("counter", name, value, labels)
}

export function gauge(name: string, value: number, labels?: Labels): void {
  emit("gauge", name, value, labels)
}

export function histogram(name: string, value: number, labels?: Labels): void {
  emit("histogram", name, value, labels)
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

export interface CounterAgg {
  total: number
  byLabels: Array<{ labels: Labels; value: number }>
}
export interface GaugeAgg {
  byLabels: Array<{ labels: Labels; value: number }>
}
export interface HistogramAgg {
  count: number
  sum: number
  min: number
  max: number
  avg: number
  p50: number
  p95: number
}
export interface MetricsSnapshot {
  generatedAt: string
  windowMs: number
  counters: Record<string, CounterAgg>
  gauges: Record<string, GaugeAgg>
  histograms: Record<string, HistogramAgg>
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

export function snapshot24h(): MetricsSnapshot {
  const ms = nowMs()
  const cutoffHour = hourOf(ms - WINDOW_MS)
  const cutoffMs = ms - WINDOW_MS

  const counterOut: Record<string, CounterAgg> = {}
  for (const [name, series] of counters) {
    let total = 0
    const byLabels: CounterAgg["byLabels"] = []
    for (const s of series.values()) {
      pruneCounter(s, cutoffHour)
      let v = 0
      for (const [h, c] of s.buckets) if (h >= cutoffHour) v += c
      if (v !== 0) {
        total += v
        byLabels.push({ labels: s.labels, value: v })
      }
    }
    counterOut[name] = { total, byLabels }
  }

  const gaugeOut: Record<string, GaugeAgg> = {}
  for (const [name, series] of gauges) {
    const byLabels: GaugeAgg["byLabels"] = []
    for (const g of series.values()) {
      if (g.ts >= cutoffMs) byLabels.push({ labels: g.labels, value: g.value })
    }
    gaugeOut[name] = { byLabels }
  }

  const histOut: Record<string, HistogramAgg> = {}
  for (const [name, buf] of histograms) {
    const fresh = buf.filter((e) => e.ts >= cutoffMs).map((e) => e.value)
    if (buf.length !== fresh.length) histograms.set(name, buf.filter((e) => e.ts >= cutoffMs))
    const sorted = [...fresh].sort((a, b) => a - b)
    const count = sorted.length
    const sum = sorted.reduce((a, b) => a + b, 0)
    histOut[name] = {
      count,
      sum,
      min: count ? sorted[0]! : 0,
      max: count ? sorted[count - 1]! : 0,
      avg: count ? sum / count : 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    }
  }

  return {
    generatedAt: new Date(ms).toISOString(),
    windowMs: WINDOW_MS,
    counters: counterOut,
    gauges: gaugeOut,
    histograms: histOut,
  }
}

/** Sum a counter's 24h value across label-sets matching `filter`. */
export function sumCounter(snap: MetricsSnapshot, name: string, filter: Labels = {}): number {
  const c = snap.counters[name]
  if (!c) return 0
  const entries = Object.entries(filter)
  return c.byLabels
    .filter((e) => entries.every(([k, v]) => String(e.labels[k]) === String(v)))
    .reduce((s, e) => s + e.value, 0)
}

/** Distinct values seen for a label key across a set of counter metric names. */
export function labelValues(snap: MetricsSnapshot, names: string[], labelKeyName: string): string[] {
  const out = new Set<string>()
  for (const name of names) {
    for (const e of snap.counters[name]?.byLabels ?? []) {
      const v = e.labels[labelKeyName]
      if (v != null) out.add(String(v))
    }
  }
  return [...out]
}

// ── Lazy periodic flush ──────────────────────────────────────────────────────

let flushTimer: ReturnType<typeof setInterval> | null = null
function ensureFlush(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => {
    const snap = snapshot24h()
    const hasData =
      Object.keys(snap.counters).length || Object.keys(snap.histograms).length || Object.keys(snap.gauges).length
    if (hasData) console.log(JSON.stringify({ event: "metrics.flush", snapshot: snap }))
  }, FLUSH_INTERVAL_MS)
  // Don't keep the process (or a test runner) alive for the flush timer.
  if (typeof flushTimer.unref === "function") flushTimer.unref()
}

/** Test-only: clear all series + stop the flush timer. */
export function __resetMetrics(): void {
  counters.clear()
  gauges.clear()
  histograms.clear()
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
}
