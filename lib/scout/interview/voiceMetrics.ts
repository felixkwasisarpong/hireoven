// Deterministic voice metrics — no LLM calls. Fast and cheap.

export const FILLER_TOKENS = [
  "you know", "sort of", "kind of", "i mean",
  "um", "uh", "er", "ah", "hmm",
  "basically", "literally", "actually", "right",
]

export const HEDGE_TOKENS = [
  "i don't know", "i'm not sure", "if that makes sense", "or something",
  "or whatever", "i feel like",
  "i think", "i guess", "maybe", "probably", "kind of", "sort of",
]

// Prefer hedge classification over filler for overlapping phrases
const HEDGE_ONLY = new Set(["kind of", "sort of"])

export interface VoiceMetrics {
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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function countPhrase(text: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = phrase.split(" ").length === 1
    ? new RegExp(`\\b${escaped}\\b`, "gi")
    : new RegExp(escaped, "gi")
  return (text.match(re) ?? []).length
}

export function computeVoiceMetrics(input: {
  candidateTurns: Array<{ content: string; startMs: number; endMs: number }>
  voiceTimings: { totalDurationMs: number; candidateSpeakingMs: number; silenceMs: number }
  interviewerTurns: Array<{ startMs: number; endMs: number }>
}): VoiceMetrics {
  const { candidateTurns, voiceTimings, interviewerTurns } = input
  const { totalDurationMs, candidateSpeakingMs, silenceMs } = voiceTimings

  const candidateMin = candidateSpeakingMs / 60_000 || 1
  const totalMin = totalDurationMs / 60_000 || 1

  // ── Fillers and hedges ─────────────────────────────────────────────────────
  const fullText = candidateTurns.map((t) => t.content.toLowerCase()).join(" ")

  const fillerBreakdown: Record<string, number> = {}
  const hedgeBreakdown: Record<string, number> = {}

  for (const token of HEDGE_TOKENS) {
    const count = countPhrase(fullText, token)
    if (count > 0) hedgeBreakdown[token] = count
  }

  for (const token of FILLER_TOKENS) {
    if (HEDGE_ONLY.has(token)) continue // classified as hedge above
    const count = countPhrase(fullText, token)
    if (count > 0) fillerBreakdown[token] = count
  }

  const fillerTotal = Object.values(fillerBreakdown).reduce((s, v) => s + v, 0)
  const hedgeTotal = Object.values(hedgeBreakdown).reduce((s, v) => s + v, 0)

  // Top-5 each
  const topFillers = Object.fromEntries(
    Object.entries(fillerBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 5)
  )
  const topHedges = Object.fromEntries(
    Object.entries(hedgeBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 5)
  )

  // ── Pace ────────────────────────────────────────────────────────────────────
  const totalWords = candidateTurns.reduce((s, t) => s + t.content.split(/\s+/).filter(Boolean).length, 0)
  const pace_wpm = round2(totalWords / candidateMin)

  // ── Silence ────────────────────────────────────────────────────────────────
  const silence_ratio = round2(silenceMs / (totalDurationMs || 1))

  // ── Longest pause (gap between consecutive candidate turns minus interviewer speaking) ───
  let longestPause = 0
  const sortedCandidate = [...candidateTurns].sort((a, b) => a.startMs - b.startMs)

  for (let i = 1; i < sortedCandidate.length; i++) {
    const gapStart = sortedCandidate[i - 1].endMs
    const gapEnd = sortedCandidate[i].startMs
    if (gapEnd <= gapStart) continue

    // Subtract interviewer speaking time that falls within this gap
    let interviewerInGap = 0
    for (const it of interviewerTurns) {
      const overlapStart = Math.max(gapStart, it.startMs)
      const overlapEnd = Math.min(gapEnd, it.endMs)
      if (overlapEnd > overlapStart) interviewerInGap += overlapEnd - overlapStart
    }

    const adjustedGap = Math.max(0, gapEnd - gapStart - interviewerInGap)
    if (adjustedGap > longestPause) longestPause = adjustedGap
  }

  const longest_pause_sec = round2(longestPause / 1000)

  // ── Response latency ────────────────────────────────────────────────────────
  const latencies: number[] = []
  for (const ct of sortedCandidate) {
    // Find the most recent interviewer turn that ended before this candidate turn started
    const prev = interviewerTurns
      .filter((it) => it.endMs <= ct.startMs)
      .sort((a, b) => b.endMs - a.endMs)[0]
    if (prev) latencies.push(Math.max(0, ct.startMs - prev.endMs))
  }
  const avg_response_latency_sec = latencies.length > 0
    ? round2(latencies.reduce((s, v) => s + v, 0) / latencies.length / 1000)
    : 0

  const metrics: VoiceMetrics = {
    filler_words_per_min: round2(fillerTotal / candidateMin),
    filler_word_breakdown: topFillers,
    pace_wpm,
    hedge_count: hedgeTotal,
    hedge_per_min: round2(hedgeTotal / totalMin),
    hedge_breakdown: topHedges,
    silence_ratio,
    longest_pause_sec,
    avg_response_latency_sec,
    comment: "",
  }

  metrics.comment = buildVoiceComment(metrics)
  return metrics
}

function buildVoiceComment(m: VoiceMetrics): string {
  const issues: string[] = []

  if (m.filler_words_per_min > 6) {
    issues.push(`heavy filler use (${m.filler_words_per_min}/min — aim for under 4)`)
  } else if (m.filler_words_per_min > 4) {
    issues.push(`moderate filler use (${m.filler_words_per_min}/min)`)
  }

  if (m.pace_wpm > 175) {
    issues.push(`speaking quickly (${m.pace_wpm} wpm — slow down for emphasis)`)
  } else if (m.pace_wpm < 110) {
    issues.push(`speaking slowly (${m.pace_wpm} wpm — energize delivery)`)
  }

  if (m.hedge_per_min > 3) {
    issues.push(`frequent hedging (${m.hedge_count} times — replace "I think" with "We did")`)
  }

  if (m.longest_pause_sec > 12) {
    issues.push(`one long silence (${m.longest_pause_sec}s) — practice bridging phrases`)
  }

  if (issues.length === 0) {
    return "Delivery was clean. No major filler, hedging, or pacing issues."
  }
  return "Notable: " + issues.join("; ") + "."
}
