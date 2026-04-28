import { getPostgresPool } from "@/lib/postgres/server"

export type ScoutBehaviorSignals = {
  preferredRoles: string[]
  preferredLocations: string[]
  commonSkills: string[]
  sponsorshipSensitivity: "high" | "medium" | "low" | "unknown"
  recentApplicationVelocity: "none" | "low" | "healthy"
  savedJobPatterns: string[]
  avoidSignals: string[]
}

// Common title words that don't indicate role preference
const TITLE_STOP_WORDS = new Set([
  "senior", "junior", "lead", "staff", "principal", "associate", "intern",
  "contract", "contractor", "part", "time", "full", "remote", "hybrid",
  "with", "and", "for", "the", "in", "at", "of", "to", "a", "an",
  "i", "ii", "iii", "iv", "role", "position", "opportunity",
])

const SPONSORSHIP_VISA_TYPES = ["f1", "opt", "h4_ead", "tn", "j1", "o1", "cpt", "stem"]

type ProfileBehaviorRow = {
  desired_roles: string[] | null
  desired_locations: string[] | null
  needs_sponsorship: boolean
  visa_status: string | null
}

type ResumeBehaviorRow = {
  top_skills: string[] | null
  skills: { technical?: string[]; soft?: string[] } | null
}

type ApplicationPatternRow = {
  title: string
  location: string | null
  is_remote: boolean
  requires_authorization: boolean
  sponsors_h1b: boolean | null
  status: string
}

type WatchlistRow = {
  company_name: string
  sponsors_h1b: boolean
}

type RecentCountRow = {
  recent_count: number
}

/**
 * Derives lightweight behavioral signals from the user's existing product activity.
 * Uses only existing DB tables — no new schema required.
 * Returns compact signals for personalizing Scout suggestions.
 */
export async function getScoutBehaviorSignals(userId: string): Promise<ScoutBehaviorSignals> {
  const pool = getPostgresPool()

  const [profileRes, resumeRes, appRes, watchlistRes, recentCountRes] = await Promise.all([
    pool.query<ProfileBehaviorRow>(
      `SELECT desired_roles, desired_locations, needs_sponsorship, visa_status
       FROM profiles WHERE id = $1 LIMIT 1`,
      [userId]
    ),
    pool.query<ResumeBehaviorRow>(
      `SELECT top_skills, skills
       FROM resumes
       WHERE user_id = $1 AND parse_status = 'complete'
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query<ApplicationPatternRow>(
      `SELECT j.title, j.location, j.is_remote, j.requires_authorization,
              j.sponsors_h1b, ja.status
       FROM job_applications ja
       JOIN jobs j ON j.id = ja.job_id
       WHERE ja.user_id = $1 AND ja.is_archived = false
       ORDER BY ja.created_at DESC
       LIMIT 30`,
      [userId]
    ),
    pool.query<WatchlistRow>(
      `SELECT c.name AS company_name, c.sponsors_h1b
       FROM watchlist w
       JOIN companies c ON c.id = w.company_id
       WHERE w.user_id = $1
       ORDER BY w.created_at DESC
       LIMIT 20`,
      [userId]
    ),
    pool.query<RecentCountRow>(
      `SELECT COUNT(*)::int AS recent_count
       FROM job_applications
       WHERE user_id = $1
         AND is_archived = false
         AND COALESCE(applied_at, created_at) >= NOW() - INTERVAL '14 days'`,
      [userId]
    ),
  ])

  const profile = profileRes.rows[0] ?? null
  const resume = resumeRes.rows[0] ?? null
  const appJobs = appRes.rows
  const watchlist = watchlistRes.rows
  const recentCount = recentCountRes.rows[0]?.recent_count ?? 0

  // ── Preferred roles ──
  const preferredRoles: string[] = []
  if (profile?.desired_roles?.length) {
    preferredRoles.push(...profile.desired_roles.slice(0, 3))
  } else if (appJobs.length >= 3) {
    // Infer from most common title tokens across recent applications
    const freq = new Map<string, number>()
    for (const j of appJobs) {
      const tokens = j.title
        .toLowerCase()
        .split(/[\s,/|()\[\]]+/)
        .filter((w) => w.length > 3 && !TITLE_STOP_WORDS.has(w))
      for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1)
    }
    const top = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .filter(([, count]) => count >= 2)
      .map(([word]) => word)
    preferredRoles.push(...top)
  }

  // ── Preferred locations ──
  const preferredLocations: string[] = []
  if (profile?.desired_locations?.length) {
    preferredLocations.push(...profile.desired_locations.slice(0, 3))
  } else if (appJobs.length >= 3) {
    const remoteCount = appJobs.filter((j) => j.is_remote).length
    if (remoteCount > appJobs.length / 2) {
      preferredLocations.push("Remote")
    }
    const locationFreq = new Map<string, number>()
    for (const j of appJobs) {
      if (j.location && !j.is_remote) {
        const city = j.location.split(",")[0].trim()
        if (city.length > 1) {
          locationFreq.set(city, (locationFreq.get(city) ?? 0) + 1)
        }
      }
    }
    const topLocations = [...locationFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .filter(([, c]) => c >= 2)
      .map(([loc]) => loc)
    preferredLocations.push(...topLocations)
  }

  // ── Common skills ──
  const commonSkills: string[] = []
  if (resume?.top_skills?.length) {
    commonSkills.push(...resume.top_skills.slice(0, 8))
  } else if (resume?.skills) {
    const technical = Array.isArray(resume.skills.technical) ? resume.skills.technical : []
    const soft = Array.isArray(resume.skills.soft) ? resume.skills.soft : []
    commonSkills.push(...[...technical, ...soft].slice(0, 8))
  }

  // ── Sponsorship sensitivity ──
  let sponsorshipSensitivity: ScoutBehaviorSignals["sponsorshipSensitivity"] = "unknown"
  if (profile) {
    if (profile.needs_sponsorship) {
      sponsorshipSensitivity = "high"
    } else if (
      profile.visa_status &&
      SPONSORSHIP_VISA_TYPES.some((kw) => profile.visa_status!.toLowerCase().includes(kw))
    ) {
      sponsorshipSensitivity = "medium"
    } else if (profile.visa_status) {
      sponsorshipSensitivity = "low"
    }
  }

  // ── Application velocity (last 14 days) ──
  let recentApplicationVelocity: ScoutBehaviorSignals["recentApplicationVelocity"] = "none"
  if (recentCount >= 4) {
    recentApplicationVelocity = "healthy"
  } else if (recentCount >= 1) {
    recentApplicationVelocity = "low"
  }

  // ── Saved job patterns ──
  const savedJobPatterns: string[] = []
  if (watchlist.length > 0) {
    const sponsorCount = watchlist.filter((c) => c.sponsors_h1b).length
    if (sponsorCount >= Math.ceil(watchlist.length / 2)) {
      savedJobPatterns.push("sponsorship-friendly companies")
    }
    savedJobPatterns.push(...watchlist.slice(0, 3).map((c) => c.company_name))
  }

  // ── Avoid signals ──
  const avoidSignals: string[] = []
  if (profile?.needs_sponsorship && appJobs.some((j) => j.requires_authorization)) {
    avoidSignals.push("jobs requiring work authorization")
  }
  const finalizedJobs = appJobs.filter((j) =>
    ["rejected", "withdrawn", "offer_declined"].includes(j.status)
  )
  if (
    finalizedJobs.length >= 3 &&
    appJobs.length >= 5 &&
    finalizedJobs.length >= Math.ceil(appJobs.length * 0.4)
  ) {
    avoidSignals.push("roles with high rejection rate")
  }

  return {
    preferredRoles,
    preferredLocations,
    commonSkills,
    sponsorshipSensitivity,
    recentApplicationVelocity,
    savedJobPatterns,
    avoidSignals,
  }
}

/**
 * Formats behavior signals into a compact string for inclusion in the Claude prompt.
 * Intentionally vague — signals are hints, not facts.
 */
export function formatBehaviorSignalsForClaude(signals: ScoutBehaviorSignals): string {
  const lines: string[] = []

  if (signals.preferredRoles.length > 0) {
    lines.push(`- Inferred preferred roles: ${signals.preferredRoles.join(", ")}`)
  }
  if (signals.preferredLocations.length > 0) {
    lines.push(`- Inferred preferred locations: ${signals.preferredLocations.join(", ")}`)
  }
  if (signals.commonSkills.length > 0) {
    lines.push(`- Resume skills (top): ${signals.commonSkills.slice(0, 6).join(", ")}`)
  }
  if (signals.sponsorshipSensitivity !== "unknown") {
    const sensitivityLabels = {
      high: "high — user likely requires sponsorship",
      medium: "medium — visa type may require sponsorship",
      low: "low — likely authorized to work",
    }
    lines.push(`- Sponsorship sensitivity: ${sensitivityLabels[signals.sponsorshipSensitivity]}`)
  }
  const velocityLabels = {
    none: "none — no applications in the last 14 days",
    low: "low — 1–3 applications in the last 14 days",
    healthy: "healthy — 4+ applications in the last 14 days",
  }
  lines.push(`- Application velocity (14d): ${velocityLabels[signals.recentApplicationVelocity]}`)
  if (signals.savedJobPatterns.length > 0) {
    lines.push(`- Watchlist signals: ${signals.savedJobPatterns.join(", ")}`)
  }
  if (signals.avoidSignals.length > 0) {
    lines.push(`- Avoid signals: ${signals.avoidSignals.join("; ")}`)
  }

  if (lines.length === 0) return ""

  return `Behavior Signals (weak hints only — do not treat as confirmed preferences):
${lines.join("\n")}`
}
