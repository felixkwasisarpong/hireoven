import type { Pool, PoolClient } from "pg"
import type { BuildCareerTwinInput, CareerTwinDimension, CareerTwinSnapshot } from "./types"

let tablesEnsured = false

async function ensureUpdatedAtTrigger(client: Pool | PoolClient): Promise<void> {
  await client.query(`
    CREATE OR REPLACE FUNCTION update_apex_career_twin_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)
}

export async function ensureCareerTwinTables(pool: Pool): Promise<void> {
  if (tablesEnsured) return

  await ensureUpdatedAtTrigger(pool)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apex_career_twin_snapshots (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      twin_version          INTEGER NOT NULL DEFAULT 1,
      headline              TEXT NOT NULL,
      summary               TEXT NOT NULL,
      strengths             JSONB NOT NULL DEFAULT '[]'::jsonb,
      risks                 JSONB NOT NULL DEFAULT '[]'::jsonb,
      constraints           JSONB NOT NULL DEFAULT '[]'::jsonb,
      recommended_focus     JSONB NOT NULL DEFAULT '[]'::jsonb,
      primary_role_category TEXT NULL,
      primary_sector        TEXT NULL,
      preferred_work_modes  JSONB NOT NULL DEFAULT '[]'::jsonb,
      confidence            INTEGER NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
      freshness_score       INTEGER NOT NULL DEFAULT 50 CHECK (freshness_score BETWEEN 0 AND 100),
      evidence_count        INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
      generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_apex_career_twin_snapshots_user_time
      ON apex_career_twin_snapshots (user_id, generated_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apex_career_twin_dimensions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id  UUID NOT NULL REFERENCES apex_career_twin_snapshots(id) ON DELETE CASCADE,
      user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      dimension_key TEXT NOT NULL,
      label        TEXT NOT NULL,
      category     TEXT NOT NULL CHECK (category IN ('fit', 'momentum', 'readiness', 'constraint', 'risk', 'focus')),
      direction    TEXT NOT NULL CHECK (direction IN ('strength', 'risk', 'constraint', 'neutral')),
      score        INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
      confidence   INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
      evidence     JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (snapshot_id, dimension_key)
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_apex_career_twin_dimensions_user_time
      ON apex_career_twin_dimensions (user_id, created_at DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apex_career_twin_events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      snapshot_id  UUID NULL REFERENCES apex_career_twin_snapshots(id) ON DELETE SET NULL,
      event_type   TEXT NOT NULL,
      payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_apex_career_twin_events_user_time
      ON apex_career_twin_events (user_id, created_at DESC)
  `)

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'apex_career_twin_snapshots_updated_at'
      ) THEN
        CREATE TRIGGER apex_career_twin_snapshots_updated_at
          BEFORE UPDATE ON apex_career_twin_snapshots
          FOR EACH ROW EXECUTE FUNCTION update_apex_career_twin_updated_at();
      END IF;
    END
    $$
  `)

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'apex_career_twin_dimensions_updated_at'
      ) THEN
        CREATE TRIGGER apex_career_twin_dimensions_updated_at
          BEFORE UPDATE ON apex_career_twin_dimensions
          FOR EACH ROW EXECUTE FUNCTION update_apex_career_twin_updated_at();
      END IF;
    END
    $$
  `)

  tablesEnsured = true
}

type SnapshotRow = {
  id: string
  user_id: string
  twin_version: number
  headline: string
  summary: string
  strengths: unknown
  risks: unknown
  constraints: unknown
  recommended_focus: unknown
  primary_role_category: string | null
  primary_sector: string | null
  preferred_work_modes: unknown
  confidence: number
  freshness_score: number
  evidence_count: number
  generated_at: string
}

type DimensionRow = {
  dimension_key: string
  label: string
  category: CareerTwinDimension["category"]
  direction: CareerTwinDimension["direction"]
  score: number
  confidence: number
  evidence: unknown
  updated_at: string
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function toWorkModes(value: unknown): Array<"remote" | "hybrid" | "onsite"> {
  if (!Array.isArray(value)) return []

  const modes = value.filter(
    (item): item is "remote" | "hybrid" | "onsite" =>
      item === "remote" || item === "hybrid" || item === "onsite"
  )

  return [...new Set(modes)]
}

function rowToDimension(row: DimensionRow): CareerTwinDimension {
  return {
    key: row.dimension_key,
    label: row.label,
    category: row.category,
    direction: row.direction,
    score: row.score,
    confidence: row.confidence,
    evidence: toStringArray(row.evidence),
    updatedAt: row.updated_at,
  }
}

function mapSnapshot(row: SnapshotRow, dimensions: CareerTwinDimension[]): CareerTwinSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    version: row.twin_version,
    headline: row.headline,
    summary: row.summary,
    strengths: toStringArray(row.strengths),
    risks: toStringArray(row.risks),
    constraints: toStringArray(row.constraints),
    recommendedFocus: toStringArray(row.recommended_focus),
    primaryRoleCategory: row.primary_role_category as CareerTwinSnapshot["primaryRoleCategory"],
    primarySector: row.primary_sector as CareerTwinSnapshot["primarySector"],
    preferredWorkModes: toWorkModes(row.preferred_work_modes),
    confidence: row.confidence,
    freshnessScore: row.freshness_score,
    evidenceCount: row.evidence_count,
    dimensions,
    generatedAt: row.generated_at,
  }
}

async function getSnapshotDimensions(
  client: Pool | PoolClient,
  snapshotId: string
): Promise<CareerTwinDimension[]> {
  const result = await client.query<DimensionRow>(
    `SELECT dimension_key, label, category, direction, score, confidence, evidence, updated_at
     FROM apex_career_twin_dimensions
     WHERE snapshot_id = $1
     ORDER BY score DESC, confidence DESC, dimension_key ASC`,
    [snapshotId]
  )

  return result.rows.map(rowToDimension)
}

export async function getLatestCareerTwin(
  userId: string,
  pool: Pool,
  opts: { maxAgeHours?: number } = {}
): Promise<CareerTwinSnapshot | null> {
  await ensureCareerTwinTables(pool)

  const values: unknown[] = [userId]
  const ageClause =
    typeof opts.maxAgeHours === "number"
      ? `AND generated_at >= NOW() - ($2::text || ' hours')::interval`
      : ""

  if (typeof opts.maxAgeHours === "number") {
    values.push(String(Math.max(1, Math.floor(opts.maxAgeHours))))
  }

  const result = await pool.query<SnapshotRow>(
    `SELECT id, user_id, twin_version, headline, summary, strengths, risks, constraints,
            recommended_focus, primary_role_category, primary_sector, preferred_work_modes,
            confidence, freshness_score, evidence_count, generated_at
     FROM apex_career_twin_snapshots
     WHERE user_id = $1
     ${ageClause}
     ORDER BY generated_at DESC
     LIMIT 1`,
    values
  )

  const row = result.rows[0]
  if (!row) return null

  const dimensions = await getSnapshotDimensions(pool, row.id)
  return mapSnapshot(row, dimensions)
}

export async function listCareerTwinSnapshots(
  userId: string,
  pool: Pool,
  limit = 5
): Promise<CareerTwinSnapshot[]> {
  await ensureCareerTwinTables(pool)

  const result = await pool.query<SnapshotRow>(
    `SELECT id, user_id, twin_version, headline, summary, strengths, risks, constraints,
            recommended_focus, primary_role_category, primary_sector, preferred_work_modes,
            confidence, freshness_score, evidence_count, generated_at
     FROM apex_career_twin_snapshots
     WHERE user_id = $1
     ORDER BY generated_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(limit, 20))]
  )

  const snapshots: CareerTwinSnapshot[] = []
  for (const row of result.rows) {
    const dimensions = await getSnapshotDimensions(pool, row.id)
    snapshots.push(mapSnapshot(row, dimensions))
  }

  return snapshots
}

export async function saveCareerTwinSnapshot(
  userId: string,
  pool: Pool,
  input: BuildCareerTwinInput
): Promise<CareerTwinSnapshot> {
  await ensureCareerTwinTables(pool)

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const snapshotResult = await client.query<SnapshotRow>(
      `INSERT INTO apex_career_twin_snapshots (
         user_id,
         twin_version,
         headline,
         summary,
         strengths,
         risks,
         constraints,
         recommended_focus,
         primary_role_category,
         primary_sector,
         preferred_work_modes,
         confidence,
         freshness_score,
         evidence_count,
         generated_at
       )
       VALUES (
         $1, 1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
         $8, $9, $10::jsonb, $11, $12, $13, NOW()
       )
       RETURNING id, user_id, twin_version, headline, summary, strengths, risks, constraints,
                 recommended_focus, primary_role_category, primary_sector, preferred_work_modes,
                 confidence, freshness_score, evidence_count, generated_at`,
      [
        userId,
        input.headline,
        input.summary,
        JSON.stringify(input.strengths),
        JSON.stringify(input.risks),
        JSON.stringify(input.constraints),
        JSON.stringify(input.recommendedFocus),
        input.primaryRoleCategory,
        input.primarySector,
        JSON.stringify(input.preferredWorkModes),
        input.confidence,
        input.freshnessScore,
        input.evidenceCount,
      ]
    )

    const snapshot = snapshotResult.rows[0]
    if (!snapshot) {
      throw new Error("Failed to create career twin snapshot")
    }

    for (const dimension of input.dimensions) {
      await client.query(
        `INSERT INTO apex_career_twin_dimensions (
           snapshot_id, user_id, dimension_key, label, category, direction,
           score, confidence, evidence
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          snapshot.id,
          userId,
          dimension.key,
          dimension.label,
          dimension.category,
          dimension.direction,
          dimension.score,
          dimension.confidence,
          JSON.stringify(dimension.evidence),
        ]
      )
    }

    await client.query(
      `INSERT INTO apex_career_twin_events (user_id, snapshot_id, event_type, payload)
       VALUES ($1, $2, 'snapshot_built', $3::jsonb)`,
      [
        userId,
        snapshot.id,
        JSON.stringify({
          reason: input.reason,
          confidence: input.confidence,
          freshnessScore: input.freshnessScore,
          evidenceCount: input.evidenceCount,
          dimensions: input.dimensions.length,
          sourceStats: input.sourceStats ?? {},
        }),
      ]
    )

    await client.query("COMMIT")

    const dimensions = await getSnapshotDimensions(client, snapshot.id)
    return mapSnapshot(snapshot, dimensions)
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
