import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import type { Resume } from "@/types"

export const runtime = "nodejs"

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
}

function toObjectOrDefault(value: unknown, fallback: Record<string, unknown>) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return fallback
}

function toArrayOrDefault(value: unknown, fallback: unknown[]) {
  if (Array.isArray(value)) return value
  return fallback
}

function defaultResumeFileName(name: string | null): string {
  const base = (name ?? "Resume")
    .replace(/\.[^./\\]+$/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return `${base || "Resume"}.docx`
}

function inferTopSkills(
  explicitTopSkills: string[],
  skills: Record<string, unknown>
): string[] {
  if (explicitTopSkills.length > 0) return explicitTopSkills.slice(0, 30)

  const buckets = ["technical", "soft", "languages", "certifications"] as const
  const merged: string[] = []
  for (const bucket of buckets) {
    const values = skills[bucket]
    if (!Array.isArray(values)) continue
    for (const value of values) {
      if (typeof value !== "string") continue
      const normalized = value.trim()
      if (normalized) merged.push(normalized)
    }
  }
  return Array.from(new Set(merged)).slice(0, 30)
}

async function ensureResumeColumns(pool: ReturnType<typeof getPostgresPool>) {
  await pool.query(
    `ALTER TABLE resumes
       ADD COLUMN IF NOT EXISTS file_type TEXT,
       ADD COLUMN IF NOT EXISTS parse_error TEXT,
       ADD COLUMN IF NOT EXISTS github_url TEXT,
       ADD COLUMN IF NOT EXISTS certifications JSONB,
       ADD COLUMN IF NOT EXISTS additional_sections JSONB,
       ADD COLUMN IF NOT EXISTS ats_score INTEGER,
       ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS content_modified BOOLEAN DEFAULT false,
       ALTER COLUMN file_url DROP NOT NULL,
       ALTER COLUMN storage_path DROP NOT NULL`
  )
}

/**
 * Backfill `content_modified` for THIS user's existing resumes. A duplicate
 * copies its parent's storage_path, so before `content_modified` existed those
 * tailored/duplicated copies streamed the parent's (often the active) file on
 * download. Flagging non-primary copies that share a storage_path with another
 * of the user's resumes forces them to regenerate from their own columns.
 * User-scoped + indexed on user_id, and only touches rows not already flagged,
 * so it stays light enough for the web box.
 */
async function backfillContentModifiedForUser(
  pool: ReturnType<typeof getPostgresPool>,
  userId: string
) {
  await pool.query(
    `UPDATE resumes r
       SET content_modified = true
     WHERE r.user_id = $1
       AND r.content_modified IS NOT TRUE
       AND r.is_primary = false
       AND r.storage_path IS NOT NULL
       AND r.storage_path <> ''
       AND EXISTS (
         SELECT 1 FROM resumes o
         WHERE o.user_id = $1
           AND o.storage_path = r.storage_path
           AND o.id <> r.id
       )`,
    [userId]
  )
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const pool = getPostgresPool()
    await ensureResumeColumns(pool)
    await backfillContentModifiedForUser(pool, user.id)
    const result = await pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE user_id = $1
       ORDER BY updated_at DESC, created_at DESC`,
      [user.id]
    )
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch resumes" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const pool = getPostgresPool()

  try {
    await ensureResumeColumns(pool)

    const plan = await getPlanForUserId(user.id)
    if (plan === "free") {
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM resumes WHERE user_id = $1 AND archived_at IS NULL`,
        [user.id]
      )
      const current = parseInt(countResult.rows[0]?.count ?? "0", 10)
      if (current >= 3) {
        return NextResponse.json(
          { error: "Free plan is limited to 3 resumes. Upgrade to Pro for unlimited.", code: "QUOTA_EXCEEDED", limit: 3 },
          { status: 429 }
        )
      }
    }

    const requestedPrimary = body.is_primary === true
    const existingPrimary = await pool.query<{ has_primary: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM resumes
         WHERE user_id = $1
           AND is_primary = true
       ) AS has_primary`,
      [user.id]
    )
    const shouldBePrimary = requestedPrimary || !existingPrimary.rows[0]?.has_primary

    if (shouldBePrimary) {
      await pool.query(
        `UPDATE resumes
         SET is_primary = false
         WHERE user_id = $1`,
        [user.id]
      )
    }

    const name =
      toTrimmedString(body.name) ??
      toTrimmedString(body.primary_role) ??
      "Resume"
    const skills = toObjectOrDefault(body.skills, {})
    const topSkills = inferTopSkills(toStringArray(body.top_skills), skills)

    const insertResult = await pool.query<Resume>(
      `INSERT INTO resumes (
        user_id,
        file_name,
        name,
        file_url,
        storage_path,
        file_size,
        file_type,
        is_primary,
        parse_status,
        parse_error,
        full_name,
        email,
        phone,
        location,
        linkedin_url,
        portfolio_url,
        github_url,
        summary,
        work_experience,
        education,
        skills,
        projects,
        certifications,
        seniority_level,
        years_of_experience,
        primary_role,
        industries,
        top_skills,
        resume_score,
        ats_score,
        raw_text
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb,
        $22::jsonb, $23::jsonb,
        $24, $25, $26, $27::text[], $28::text[], $29, $30, $31
      )
      RETURNING *`,
      [
        user.id,
        defaultResumeFileName(name),
        name,
        null,
        null,
        null,
        "manual",
        shouldBePrimary,
        "complete",
        null,
        toTrimmedString(body.full_name),
        toTrimmedString(body.email),
        toTrimmedString(body.phone),
        toTrimmedString(body.location),
        toTrimmedString(body.linkedin_url),
        toTrimmedString(body.portfolio_url),
        toTrimmedString(body.github_url),
        toTrimmedString(body.summary),
        JSON.stringify(toArrayOrDefault(body.work_experience, [])),
        JSON.stringify(toArrayOrDefault(body.education, [])),
        JSON.stringify(skills),
        JSON.stringify(toArrayOrDefault(body.projects, [])),
        JSON.stringify(toArrayOrDefault(body.certifications, [])),
        toTrimmedString(body.seniority_level),
        toNumberOrNull(body.years_of_experience),
        toTrimmedString(body.primary_role),
        toStringArray(body.industries),
        topSkills,
        toNumberOrNull(body.resume_score),
        toNumberOrNull(body.ats_score),
        toTrimmedString(body.raw_text),
      ]
    )

    return NextResponse.json(insertResult.rows[0] ?? null)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create resume" },
      { status: 500 }
    )
  }
}
