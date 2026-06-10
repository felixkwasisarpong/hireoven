import { getPostgresPool } from "@/lib/postgres/server"

export type NetworkingContactType = "connection" | "alumni" | "second_degree" | "recruiter"
export type NetworkingConfidence = "high" | "medium" | "low"

export type NetworkingContact = {
  id: string
  type: NetworkingContactType
  name: string
  role: string | null
  team: string | null
  company: string | null
  confidence: NetworkingConfidence
  reason: string
  source: "cohort_members" | "employer_cohort_requests" | "linkedin_connections"
  linkedinUrl: string | null
  email: string | null
}

export type JobNetworkingContactsResult = {
  jobId: string
  companyId: string | null
  companyName: string | null
  contacts: NetworkingContact[]
}

type JobRow = {
  id: string
  company_id: string | null
  company_name: string | null
  title: string
  skills: string[] | null
}

type AlumniRow = {
  member_id: string
  user_id: string
  role_title: string
  department: string
  skills: string[] | null
  linkedin_url: string | null
  vouches_received: number
  joined_at: string
  full_name: string | null
  viewer_is_member: boolean
}

type RecruiterRow = {
  request_id: string
  contact_email: string
  roles_needed: string[] | null
  headcount_requested: number
  status: string
  created_at: string
}

type SecondDegreeRow = {
  member_id: string
  user_id: string
  role_title: string
  department: string
  skills: string[] | null
  linkedin_url: string | null
  vouches_received: number
  joined_at: string
  full_name: string | null
  cohort_company_name: string
}

type LinkedInConnectionRow = {
  id: string
  name: string
  title: string | null
  company: string | null
  degree: number
  profile_url: string | null
  mutual_count: number
  recently_active: boolean
  referral_score: number
  referral_tier: "hot" | "warm" | "cold"
}

function normalizeSkill(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Canonical company key shared by the Shadow Network writer (persist side) and
 * this finder (read side). Lower-cased, punctuation/suffix-stripped so "Govini",
 * "Govini, Inc." and "govini  inc" all collapse to the same match key.
 */
export function normalizeCompanyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|llc|ltd|corp|co|company|incorporated|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function formatDisplayName(fullName: string | null, fallback: string): string {
  const value = (fullName ?? "").trim()
  if (!value) return fallback
  return value
}

function anonymizeDisplayName(fullName: string | null, fallback: string): string {
  const value = (fullName ?? "").trim()
  if (!value) return fallback
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] ?? fallback
  const first = parts[0] ?? fallback
  const lastInitial = parts[parts.length - 1]?.charAt(0).toUpperCase()
  if (!lastInitial) return first
  return `${first} ${lastInitial}.`
}

function confidenceRank(value: NetworkingConfidence): number {
  if (value === "high") return 3
  if (value === "medium") return 2
  return 1
}

function parseEmailName(email: string): string {
  const local = email.split("@")[0] ?? "recruiter"
  const cleaned = local.replace(/[._-]+/g, " ").trim()
  if (!cleaned) return "Recruiting Contact"
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function daysBetween(nowMs: number, iso: string): number | null {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.floor((nowMs - parsed) / 86_400_000))
}

function overlapSkills(peerSkills: string[] | null, jobSkillSet: Set<string>): string[] {
  if (!peerSkills?.length || jobSkillSet.size === 0) return []
  const matched: string[] = []
  for (const skill of peerSkills) {
    const normalized = normalizeSkill(skill)
    if (!normalized) continue
    if (!jobSkillSet.has(normalized)) continue
    matched.push(skill.trim())
  }
  return uniqueCaseInsensitive(matched)
}

export async function getJobNetworkingContacts(input: {
  jobId: string
  userId: string | null
}): Promise<JobNetworkingContactsResult> {
  const pool = getPostgresPool()
  const jobResult = await pool.query<JobRow>(
    `SELECT j.id, j.company_id, c.name AS company_name, j.title, j.skills
     FROM public.jobs j
     LEFT JOIN public.companies c ON c.id = j.company_id
     WHERE j.id = $1::uuid
     LIMIT 1`,
    [input.jobId]
  )

  const job = jobResult.rows[0]
  if (!job) {
    return { jobId: input.jobId, companyId: null, companyName: null, contacts: [] }
  }

  const companyId = job.company_id
  const companyName = job.company_name
  // LinkedIn connections match on company name alone, so we only need a name to
  // do anything useful. Cohort/recruiter sources additionally require a company_id.
  if (!companyName) {
    return { jobId: input.jobId, companyId: companyId ?? null, companyName: null, contacts: [] }
  }

  const normalizedJobSkills = new Set((job.skills ?? []).map(normalizeSkill).filter(Boolean))
  const companyKey = normalizeCompanyKey(companyName)
  const nowMs = Date.now()

  const noRows = Promise.resolve({ rows: [] as never[] })

  const [alumniResult, recruiterResult, secondDegreeResult, linkedInResult] = await Promise.all([
    companyId
    ? pool.query<AlumniRow>(
      `SELECT
         cm.id AS member_id,
         cm.user_id,
         cm.role_title,
         cm.department,
         cm.skills,
         cm.linkedin_url,
         cm.vouches_received,
         cm.joined_at::text,
         p.full_name,
         (viewer_member.id IS NOT NULL) AS viewer_is_member
       FROM public.layoff_cohorts lc
       JOIN public.cohort_members cm ON cm.cohort_id = lc.id
       JOIN public.profiles p ON p.id = cm.user_id
       LEFT JOIN public.cohort_members viewer_member
         ON viewer_member.cohort_id = lc.id
        AND viewer_member.user_id = $2::uuid
       WHERE lc.company_id = $1::uuid
         AND cm.is_visible = true
       ORDER BY cm.vouches_received DESC, cm.joined_at DESC
       LIMIT 6`,
      [companyId, input.userId]
    )
    : noRows,
    companyId
    ? pool.query<RecruiterRow>(
      `SELECT
         ecr.id AS request_id,
         ecr.contact_email,
         ecr.roles_needed,
         ecr.headcount_requested,
         ecr.status::text,
         ecr.created_at::text
       FROM public.employer_cohort_requests ecr
       WHERE ecr.company_id = $1::uuid
         AND ecr.contact_email IS NOT NULL
       ORDER BY ecr.created_at DESC
       LIMIT 4`,
      [companyId]
    )
    : noRows,
    input.userId
      ? pool.query<SecondDegreeRow>(
          `SELECT
             cm.id AS member_id,
             cm.user_id,
             cm.role_title,
             cm.department,
             cm.skills,
             cm.linkedin_url,
             cm.vouches_received,
             cm.joined_at::text,
             p.full_name,
             lc.company_name AS cohort_company_name
           FROM public.cohort_members mine
           JOIN public.cohort_members cm
             ON cm.cohort_id = mine.cohort_id
            AND cm.user_id != mine.user_id
            AND cm.is_visible = true
           JOIN public.layoff_cohorts lc ON lc.id = cm.cohort_id
           JOIN public.profiles p ON p.id = cm.user_id
           WHERE mine.user_id = $1::uuid
           ORDER BY cm.vouches_received DESC, cm.joined_at DESC
           LIMIT 80`,
          [input.userId]
        )
      : Promise.resolve({ rows: [] as SecondDegreeRow[] }),
    input.userId
      ? pool.query<LinkedInConnectionRow>(
          `SELECT
             id,
             name,
             title,
             company,
             degree,
             profile_url,
             mutual_count,
             recently_active,
             referral_score,
             referral_tier::text
           FROM public.linkedin_connections
           WHERE user_id = $1::uuid
             AND company_norm = $2
           ORDER BY referral_score DESC
           LIMIT 8`,
          [input.userId, companyKey]
        )
      : Promise.resolve({ rows: [] as LinkedInConnectionRow[] })
  ])

  const alumniContacts: NetworkingContact[] = alumniResult.rows.map((row) => {
    const canRevealIdentity = row.viewer_is_member || row.user_id === input.userId
    const hasLinkedIn = canRevealIdentity && Boolean(row.linkedin_url)
    const confidence: NetworkingConfidence =
      hasLinkedIn && row.vouches_received >= 2
        ? "high"
        : hasLinkedIn || row.vouches_received >= 1
          ? "medium"
          : "low"
    return {
      id: `alumni:${row.member_id}`,
      type: "alumni",
      name: canRevealIdentity
        ? formatDisplayName(row.full_name, "Alumni contact")
        : anonymizeDisplayName(row.full_name, "Alumni member"),
      role: row.role_title || null,
      team: row.department || null,
      company: companyName,
      confidence,
      reason:
        !canRevealIdentity
          ? "Visible cohort member. Join the cohort for direct contact details."
          : row.vouches_received > 0
          ? `Verified alumni with ${row.vouches_received} cohort vouch${row.vouches_received === 1 ? "" : "es"}.`
          : "Visible company alumni from layoff cohort data.",
      source: "cohort_members",
      linkedinUrl: canRevealIdentity ? (row.linkedin_url ?? null) : null,
      email: null,
    }
  })

  const recruiterContactsByEmail = new Map<string, NetworkingContact>()
  for (const row of recruiterResult.rows) {
    const email = row.contact_email.trim().toLowerCase()
    if (!email || recruiterContactsByEmail.has(email)) continue
    const ageDays = daysBetween(nowMs, row.created_at)
    const confidence: NetworkingConfidence =
      ageDays != null && ageDays <= 90
        ? "high"
        : ageDays != null && ageDays <= 240
          ? "medium"
          : "low"
    const topRole = (row.roles_needed ?? []).filter(Boolean)[0] ?? null
    recruiterContactsByEmail.set(email, {
      id: `recruiter:${row.request_id}`,
      type: "recruiter",
      name: parseEmailName(row.contact_email),
      role: topRole,
      team: "Recruiting",
      company: companyName,
      confidence,
      reason:
        row.status === "pending"
          ? "Active hiring request contact from employer pipeline."
          : "Recent hiring contact captured in employer request data.",
      source: "employer_cohort_requests",
      linkedinUrl: null,
      email: row.contact_email,
    })
  }
  const recruiterContacts = Array.from(recruiterContactsByEmail.values())

  const secondDegreeByUser = new Map<string, NetworkingContact & { _overlapCount: number }>()
  for (const row of secondDegreeResult.rows) {
    const matched = overlapSkills(row.skills, normalizedJobSkills)
    if (matched.length === 0 && normalizedJobSkills.size > 0) continue

    const existing = secondDegreeByUser.get(row.user_id)
    const overlapCount = matched.length
    if (existing && existing._overlapCount >= overlapCount) continue

    const confidence: NetworkingConfidence =
      overlapCount >= 3
        ? "high"
        : overlapCount >= 2
          ? "medium"
          : normalizedJobSkills.size === 0 && row.vouches_received >= 2
            ? "medium"
            : "low"

    secondDegreeByUser.set(row.user_id, {
      id: `second:${row.member_id}`,
      type: "second_degree",
      name: formatDisplayName(row.full_name, "Cohort peer"),
      role: row.role_title || null,
      team: row.department || null,
      company: row.cohort_company_name || null,
      confidence,
      reason:
        overlapCount > 0
          ? `Shared cohort link with ${overlapCount} overlapping job skill${overlapCount === 1 ? "" : "s"} (${matched.slice(0, 3).join(", ")}).`
          : "Shared cohort connection with strong peer vouches.",
      source: "cohort_members",
      linkedinUrl: row.linkedin_url ?? null,
      email: null,
      _overlapCount: overlapCount,
    })
  }

  const secondDegreeContacts = Array.from(secondDegreeByUser.values())
    .sort((a, b) => b._overlapCount - a._overlapCount || confidenceRank(b.confidence) - confidenceRank(a.confidence))
    .slice(0, 5)
    .map(({ _overlapCount, ...contact }) => contact)

  const linkedInContacts: NetworkingContact[] = linkedInResult.rows.map((row) => {
    const confidence: NetworkingConfidence =
      row.referral_tier === "hot" ? "high" : row.referral_tier === "warm" ? "medium" : "low"
    const degreeLabel = row.degree === 1 ? "1st-degree connection" : "2nd-degree connection"
    const signals: string[] = []
    if (row.mutual_count > 0) signals.push(`${row.mutual_count} mutual${row.mutual_count === 1 ? "" : "s"}`)
    if (row.recently_active) signals.push("recently active")
    return {
      id: `linkedin:${row.id}`,
      type: row.degree === 1 ? "connection" : "second_degree",
      name: formatDisplayName(row.name, "LinkedIn connection"),
      role: row.title || null,
      team: null,
      company: row.company || companyName,
      confidence,
      reason: signals.length > 0 ? `${degreeLabel} · ${signals.join(", ")}.` : `${degreeLabel} at ${companyName}.`,
      source: "linkedin_connections",
      linkedinUrl: row.profile_url ?? null,
      email: null,
    }
  })

  const contacts = [...linkedInContacts, ...alumniContacts, ...recruiterContacts, ...secondDegreeContacts]
    .sort((a, b) => {
      const typeOrder: Record<NetworkingContactType, number> = {
        connection: 0,
        alumni: 1,
        recruiter: 2,
        second_degree: 3,
      }
      const byType = typeOrder[a.type] - typeOrder[b.type]
      if (byType !== 0) return byType
      return confidenceRank(b.confidence) - confidenceRank(a.confidence)
    })
    .slice(0, 12)

  return {
    jobId: input.jobId,
    companyId,
    companyName,
    contacts,
  }
}
