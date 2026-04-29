import { getJobIntelligence } from "@/lib/jobs/intelligence"
import {
  publishLocalNotificationOnce,
  type LocalNotificationTag,
} from "@/lib/hooks/useNotifications"
import type { JobWithCompany, JobWithMatchScore } from "@/types"

type FeedSignalSource = "hireoven" | "linkedin" | "glassdoor"
type FeedJob = JobWithCompany | JobWithMatchScore

type SignalCandidate = {
  priority: number
  dedupeKey: string
  cooldownMinutes: number
  type: "job_match" | "visa" | "risk"
  title: string
  message: string
  href: string
  tone: "info" | "success" | "error"
  tags: LocalNotificationTag[]
  context: {
    source: FeedSignalSource
    jobId: string
    company: string
    matchScore?: number | null
    sponsorshipScore?: number | null
    ghostRisk?: "low" | "medium" | "high" | "unknown" | null
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function hoursSince(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return null
  const ageMs = Date.now() - parsed
  return Math.max(0, Math.floor(ageMs / 3_600_000))
}

function sourceLabel(source: FeedSignalSource) {
  if (source === "linkedin") return "LinkedIn"
  if (source === "glassdoor") return "Glassdoor"
  return "Hireoven"
}

function buildSignalCandidates(job: FeedJob, source: FeedSignalSource): SignalCandidate[] {
  const candidates: SignalCandidate[] = []
  const company = job.company?.name ?? "Tracked company"
  const location = job.location?.trim() || (job.is_remote ? "Remote" : "Location unavailable")
  const matchScore = toFiniteNumber(("match_score" in job ? job.match_score?.overall_score : null) ?? null)
  const sponsorshipScore = toFiniteNumber(job.sponsorship_score)
  const likelySponsor = job.sponsors_h1b === true || (sponsorshipScore ?? 0) >= 70
  const ageHours = hoursSince(job.first_detected_at)

  const intel = getJobIntelligence(job)
  const ghostRisk = (intel.ghostJobRisk?.riskLevel ?? "unknown").toLowerCase() as
    | "low"
    | "medium"
    | "high"
    | "unknown"

  const href = `/dashboard/jobs/${job.id}`
  const sourceText = sourceLabel(source)

  if (matchScore !== null && matchScore >= 82 && (ageHours === null || ageHours <= 96)) {
    const tags: LocalNotificationTag[] = [
      { label: `${Math.round(matchScore)}% match`, tone: "success" },
    ]
    if (likelySponsor) {
      tags.push({ label: "H1B likely", tone: "success" })
    }
    if (ghostRisk === "low") {
      tags.push({ label: "Low ghost risk", tone: "info" })
    }

    candidates.push({
      priority: 95,
      dedupeKey: `feed:match:${job.id}:${Math.floor(matchScore / 5)}`,
      cooldownMinutes: 12 * 60,
      type: "job_match",
      title: `${Math.round(matchScore)}% match: ${job.title}`,
      message: `${company} · ${location} · Fresh signal from ${sourceText}.`,
      href,
      tone: "success",
      tags,
      context: {
        source,
        jobId: job.id,
        company,
        matchScore,
        sponsorshipScore,
        ghostRisk,
      },
    })
  }

  if (likelySponsor && job.requires_authorization !== true && (ageHours === null || ageHours <= 168)) {
    const scoreText = sponsorshipScore !== null ? `score ${Math.round(sponsorshipScore)}` : "strong history"
    candidates.push({
      priority: 82,
      dedupeKey: `feed:visa:${job.id}`,
      cooldownMinutes: 14 * 60,
      type: "visa",
      title: `Sponsorship-friendly role at ${company}`,
      message: `${company} shows ${scoreText}. Open this role before it cools down.`,
      href,
      tone: "success",
      tags: [
        { label: "H1B likely", tone: "success" },
        sponsorshipScore !== null
          ? { label: `Sponsor ${Math.round(sponsorshipScore)}`, tone: "info" }
          : { label: "Sponsor history", tone: "info" },
      ],
      context: {
        source,
        jobId: job.id,
        company,
        matchScore,
        sponsorshipScore,
        ghostRisk,
      },
    })
  }

  if (ghostRisk === "high") {
    candidates.push({
      priority: 91,
      dedupeKey: `feed:ghost:${job.id}`,
      cooldownMinutes: 18 * 60,
      type: "risk",
      title: `Ghost-job risk flagged for ${company}`,
      message: `${job.title} has a high ghost-risk signal. Apply only if this is still an active priority role.`,
      href,
      tone: "error",
      tags: [
        { label: "Ghost risk: high", tone: "danger" },
        matchScore !== null
          ? { label: `${Math.round(matchScore)}% match`, tone: "neutral" }
          : { label: "Needs manual review", tone: "warning" },
      ],
      context: {
        source,
        jobId: job.id,
        company,
        matchScore,
        sponsorshipScore,
        ghostRisk,
      },
    })
  }

  return candidates
}

export function publishFeedSignalNotifications(
  jobs: FeedJob[],
  options?: {
    source?: FeedSignalSource
    maxPerRun?: number
  }
) {
  if (typeof window === "undefined") return
  if (!Array.isArray(jobs) || jobs.length === 0) return

  const source = options?.source ?? "hireoven"
  const maxPerRun = Math.min(4, Math.max(1, options?.maxPerRun ?? 2))

  const candidates = jobs
    .slice(0, 30)
    .flatMap((job) => buildSignalCandidates(job, source))
    .sort((left, right) => right.priority - left.priority)

  const usedKeys = new Set<string>()
  let published = 0
  for (const candidate of candidates) {
    if (published >= maxPerRun) break
    if (usedKeys.has(candidate.dedupeKey)) continue
    usedKeys.add(candidate.dedupeKey)

    const publishedThisCandidate = publishLocalNotificationOnce({
      dedupeKey: candidate.dedupeKey,
      cooldownMinutes: candidate.cooldownMinutes,
      type: candidate.type,
      title: candidate.title,
      message: candidate.message,
      href: candidate.href,
      tone: candidate.tone,
      tags: candidate.tags,
      context: candidate.context,
    })
    if (publishedThisCandidate) published += 1
  }
}
