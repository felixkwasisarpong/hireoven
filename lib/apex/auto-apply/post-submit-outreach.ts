import { getPostgresPool } from "@/lib/postgres/server"
import {
  getJobNetworkingContacts,
  type NetworkingContact,
} from "@/lib/networking/job-contact-finder"
import {
  CADENCES,
  planSequenceSteps,
  type OutreachChannel,
  type OutreachGoal,
} from "@/lib/apex/outreach/sequence"
import { generateSequenceDrafts } from "@/lib/apex/outreach/draft-sequence"

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>
}

type PoolLike = Queryable & {
  connect(): Promise<Queryable & { release(): void }>
}

export type PreparedOutreach = {
  created: number
  skipped: number
}

type OutreachTarget = {
  goal: OutreachGoal
  channel: OutreachChannel
  contactName: string | null
  contactRole: string | null
}

const MANAGER_ROLE_RE =
  /\b(hiring manager|engineering manager|product manager|design manager|director|head of|vp|vice president|founder|cto|chief|team lead|tech lead|staff engineer|principal engineer)\b/i
const RECRUITER_ROLE_RE = /\b(recruiter|talent acquisition|sourcer|people partner|human resources|\bhr\b)\b/i

function confidenceRank(contact: NetworkingContact): number {
  if (contact.confidence === "high") return 3
  if (contact.confidence === "medium") return 2
  return 1
}

function sortContacts(a: NetworkingContact, b: NetworkingContact): number {
  return confidenceRank(b) - confidenceRank(a)
}

function isRecruiterLike(contact: NetworkingContact): boolean {
  return contact.type === "recruiter" || RECRUITER_ROLE_RE.test(contact.role ?? "")
}

function isManagerLike(contact: NetworkingContact): boolean {
  if (isRecruiterLike(contact)) return false
  return MANAGER_ROLE_RE.test(contact.role ?? "")
}

export function selectPostSubmitOutreachTargets(contacts: NetworkingContact[]): OutreachTarget[] {
  const targets: OutreachTarget[] = []

  const recruiter = contacts.filter(isRecruiterLike).sort(sortContacts)[0]
  if (recruiter) {
    targets.push({
      goal: "recruiter_intro",
      channel: "linkedin",
      contactName: recruiter.name,
      contactRole: recruiter.role ?? recruiter.team ?? "Recruiting",
    })
  }

  const manager = contacts.filter(isManagerLike).sort(sortContacts)[0]
  if (manager) {
    targets.push({
      goal: "hiring_manager",
      channel: "linkedin",
      contactName: manager.name,
      contactRole: manager.role ?? manager.team ?? "Hiring manager",
    })
  }

  if (!manager) {
    const referrer = contacts
      .filter((contact) => !isRecruiterLike(contact))
      .sort(sortContacts)[0]
    if (referrer) {
      targets.push({
        goal: "referral_request",
        channel: "linkedin",
        contactName: referrer.name,
        contactRole: referrer.role ?? referrer.team,
      })
    }
  }

  return targets.slice(0, 2)
}

/**
 * Cut a résumé summary down to a headline without slicing mid-sentence.
 *
 * A raw slice(0, 200) put "Owned a platform sustaining over 1 million
 * transactions per day at approximately." into a real recruiter draft — the
 * fragment reads as a mistake the candidate made, in a message sent under
 * their name.
 */
export function trimToSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length <= max) return clean

  const window = clean.slice(0, max)
  const lastStop = Math.max(
    window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "),
  )
  // A sentence boundary is the clean cut. Failing that, fall back to the last
  // whole word — never a half word, and never a dangling preposition's worth of
  // a clause we can avoid by stopping earlier.
  if (lastStop > 0) return window.slice(0, lastStop + 1)
  const lastSpace = window.lastIndexOf(" ")
  return lastSpace > 0 ? window.slice(0, lastSpace) : window
}

async function sequenceExists(
  pool: Queryable,
  input: {
    userId: string
    jobId: string
    goal: OutreachGoal
    contactName: string | null
    contactRole: string | null
  },
): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id
       FROM outreach_sequences
      WHERE user_id = $1::uuid
        AND job_id = $2::uuid
        AND goal = $3
        AND lower(COALESCE(contact_name, '')) = lower($4::text)
        AND lower(COALESCE(contact_role, '')) = lower($5::text)
      LIMIT 1`,
    [
      input.userId,
      input.jobId,
      input.goal,
      input.contactName ?? "",
      input.contactRole ?? "",
    ],
  )
  return rows.length > 0
}

async function createSequence(
  pool: PoolLike,
  input: {
    userId: string
    jobId: string
    companyId: string | null
    companyName: string
    jobTitle: string
    target: OutreachTarget
  },
): Promise<boolean> {
  if (
    await sequenceExists(pool, {
      userId: input.userId,
      jobId: input.jobId,
      goal: input.target.goal,
      contactName: input.target.contactName,
      contactRole: input.target.contactRole,
    })
  ) {
    return false
  }

  const [profileRes, resumeRes] = await Promise.all([
    pool.query<{ full_name: string | null }>(
      `SELECT full_name FROM profiles WHERE id = $1 LIMIT 1`,
      [input.userId],
    ),
    pool.query<{ summary: string | null; top_skills: string[] | null }>(
      `SELECT summary, top_skills
         FROM resumes
        WHERE user_id = $1 AND parse_status = 'complete'
        ORDER BY is_primary DESC, updated_at DESC
        LIMIT 1`,
      [input.userId],
    ),
  ])

  const candidateName = profileRes.rows[0]?.full_name?.trim() || "the candidate"
  const candidateHeadline =
    trimToSentence(resumeRes.rows[0]?.summary ?? "", 200) ||
    "a strong candidate for this role"
  const topStrengths = resumeRes.rows[0]?.top_skills ?? []
  const now = new Date().toISOString()
  const planned = planSequenceSteps(input.target.goal, input.target.channel, now)
  const drafts = await generateSequenceDrafts(
    {
      goal: input.target.goal,
      channel: input.target.channel,
      candidateName,
      candidateHeadline,
      topStrengths,
      companyName: input.companyName,
      jobTitle: input.jobTitle,
      contactName: input.target.contactName,
      contactRole: input.target.contactRole,
      applicationStatus: "submitted",
    },
    CADENCES[input.target.goal],
  )

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const seq = await client.query<{ id: string }>(
      `INSERT INTO outreach_sequences
         (user_id, company_id, job_id, goal, channel, contact_name, contact_role,
          company_name, job_title, status, next_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)
       RETURNING id`,
      [
        input.userId,
        input.companyId,
        input.jobId,
        input.target.goal,
        input.target.channel,
        input.target.contactName,
        input.target.contactRole,
        input.companyName,
        input.jobTitle,
        planned[0]?.scheduledFor ?? now,
      ],
    )
    const sequenceId = seq.rows[0].id
    for (const step of planned) {
      const draft = drafts.find((item) => item.stepNumber === step.stepNumber)?.draft ?? ""
      await client.query(
        `INSERT INTO outreach_steps
           (sequence_id, user_id, step_number, kind, purpose, draft, status, scheduled_for)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
        [
          sequenceId,
          input.userId,
          step.stepNumber,
          step.kind,
          step.purpose,
          draft,
          step.scheduledFor,
        ],
      )
    }
    await client.query("COMMIT")
    return true
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[auto-apply/outreach] sequence create failed:", error)
    return false
  } finally {
    client.release()
  }
}

export async function preparePostSubmitOutreach(input: {
  userId: string
  jobId: string
  companyName: string
  jobTitle: string
  pool?: PoolLike
}): Promise<PreparedOutreach> {
  const pool = input.pool ?? (getPostgresPool() as PoolLike)
  const contacts = await getJobNetworkingContacts({
    userId: input.userId,
    jobId: input.jobId,
  }).catch(() => null)

  const companyId = contacts?.companyId ?? null
  const targets = selectPostSubmitOutreachTargets(contacts?.contacts ?? [])
  if (targets.length === 0) {
    targets.push({
      goal: "recruiter_intro",
      channel: "linkedin",
      contactName: null,
      contactRole: "Recruiting team",
    })
  }

  let created = 0
  let skipped = 0
  for (const target of targets) {
    const ok = await createSequence(pool, {
      userId: input.userId,
      jobId: input.jobId,
      companyId,
      companyName: input.companyName,
      jobTitle: input.jobTitle,
      target,
    })
    if (ok) created++
    else skipped++
  }

  return { created, skipped }
}
