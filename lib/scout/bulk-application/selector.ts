import type { BulkJobItem } from "./types"

export type BulkJobCandidate = {
  jobId:             string
  jobTitle:          string
  company?:          string
  applyUrl?:         string | null
  matchScore?:       number | null
  sponsorshipSignal?: string | null
  ghostRisk?:        "low" | "medium" | "high" | null
  salary?:           string | null
  workMode?:         string | null
  alreadyApplied?:   boolean
  postedAt?:         string | null
}

export type BulkSelectionOptions = {
  count?:                  number
  requireSponsorshipSignal?: boolean
  excludeHighGhostRisk?:   boolean
  workMode?:               string
  minMatchScore?:          number
}

function scoreCandidate(job: BulkJobCandidate): number {
  let score = 0

  if (typeof job.matchScore === "number") score += job.matchScore * 0.5

  const sig = (job.sponsorshipSignal ?? "").toLowerCase()
  if (/high|strong|confirm|yes/.test(sig))     score += 30
  else if (/moderate|medium|likely/.test(sig)) score += 15
  else if (/no |none|not|without/.test(sig))   score -= 40

  if (job.ghostRisk === "low")  score += 15
  if (job.ghostRisk === "high") score -= 20

  if (job.postedAt) {
    const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / 86_400_000
    if (ageDays < 3)  score += 10
    else if (ageDays < 7)  score += 5
    else if (ageDays > 30) score -= 10
  }

  if (job.salary) score += 3

  return score
}

function makeQueueId(): string {
  return `bj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

const BLANK_ARTIFACTS = {
  resumeTailorStatus: "pending" as const,
  coverLetterStatus:  "pending" as const,
  autofillStatus:     "pending" as const,
}

export function selectJobsForBulk(
  candidates: BulkJobCandidate[],
  options: BulkSelectionOptions = {},
): BulkJobItem[] {
  const {
    count = 10,
    requireSponsorshipSignal = false,
    excludeHighGhostRisk = true,
    workMode,
    minMatchScore,
  } = options

  const filtered = candidates.filter((j) => {
    if (j.alreadyApplied) return false
    if (!j.applyUrl)       return false

    if (requireSponsorshipSignal) {
      const sig = (j.sponsorshipSignal ?? "").toLowerCase()
      if (/no |none|not|without/.test(sig)) return false
    }

    if (excludeHighGhostRisk && j.ghostRisk === "high") return false

    if (workMode && j.workMode && j.workMode.toLowerCase() !== workMode.toLowerCase()) return false

    if (typeof minMatchScore === "number" && typeof j.matchScore === "number" && j.matchScore < minMatchScore) return false

    return true
  })

  const scored = filtered
    .map((j) => ({ ...j, _score: scoreCandidate(j) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, count)

  return scored.map((j) => ({
    queueId:           makeQueueId(),
    jobId:             j.jobId,
    jobTitle:          j.jobTitle,
    company:           j.company,
    applyUrl:          j.applyUrl ?? undefined,
    matchScore:        j.matchScore,
    sponsorshipSignal: j.sponsorshipSignal,
    ghostRisk:         j.ghostRisk,
    status:            "pending" as const,
    artifacts:         { ...BLANK_ARTIFACTS },
    warnings:          [],
    addedAt:           new Date().toISOString(),
  }))
}
