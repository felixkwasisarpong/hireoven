export const STALE_JOB_THRESHOLD_DAYS = 45
export const VERY_STALE_JOB_THRESHOLD_DAYS = 90
export const POSSIBLE_REPOST_THRESHOLD = 3
export const FREQUENT_REPOST_THRESHOLD = 5

type SignalKind = "stale" | "repost"
type SignalTone = "warning" | "critical"

export type GhostRepostSignal = {
  kind: SignalKind
  tone: SignalTone
  label: string
  detail: string
}

type ResolveGhostRepostSignalsInput = {
  freshnessDays: number | null
  repostCount: number | null
}

type OptionalJobSignalData = {
  ghost_repost_count?: number | null
  raw_data?: Record<string, unknown> | null
  job_intelligence?: {
    ghostJobRisk?: {
      repostCount?: number | null
    } | null
  } | null
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
}

export function readJobRepostCount(job: OptionalJobSignalData): number | null {
  const fromJoinedColumn = toNonNegativeInt(job.ghost_repost_count)
  if (fromJoinedColumn !== null) return fromJoinedColumn

  const fromIntelligence = toNonNegativeInt(job.job_intelligence?.ghostJobRisk?.repostCount)
  if (fromIntelligence !== null) return fromIntelligence

  const raw = job.raw_data
  if (!raw || typeof raw !== "object") return null

  const keys = [
    "repost_count",
    "repostCount",
    "times_seen",
    "timesSeen",
    "seen_count",
    "seenCount",
  ] as const
  for (const key of keys) {
    const parsed = toNonNegativeInt(raw[key])
    if (parsed !== null) return parsed
  }
  return null
}

export function resolveGhostRepostSignals(
  input: ResolveGhostRepostSignalsInput
): GhostRepostSignal[] {
  const signals: GhostRepostSignal[] = []

  if (typeof input.freshnessDays === "number" && Number.isFinite(input.freshnessDays)) {
    if (input.freshnessDays > VERY_STALE_JOB_THRESHOLD_DAYS) {
      signals.push({
        kind: "stale",
        tone: "critical",
        label: "Very stale (90+d)",
        detail: `Posting was first detected ${input.freshnessDays} days ago. Roles older than ${VERY_STALE_JOB_THRESHOLD_DAYS} days are often slow-moving or outdated.`,
      })
    } else if (input.freshnessDays > STALE_JOB_THRESHOLD_DAYS) {
      signals.push({
        kind: "stale",
        tone: "warning",
        label: "Stale (45+d)",
        detail: `Posting was first detected ${input.freshnessDays} days ago. Roles older than ${STALE_JOB_THRESHOLD_DAYS} days should be verified before applying.`,
      })
    }
  }

  if (typeof input.repostCount === "number" && Number.isFinite(input.repostCount)) {
    if (input.repostCount >= FREQUENT_REPOST_THRESHOLD) {
      signals.push({
        kind: "repost",
        tone: "critical",
        label: "Frequent repost (5+)",
        detail: `This role has appeared ${input.repostCount} times in the last scan window, which can indicate repeated reposting.`,
      })
    } else if (input.repostCount >= POSSIBLE_REPOST_THRESHOLD) {
      signals.push({
        kind: "repost",
        tone: "warning",
        label: "Possible repost (3+)",
        detail: `This role has appeared ${input.repostCount} times recently. Double-check that it is still actively hiring.`,
      })
    }
  }

  return signals
}
