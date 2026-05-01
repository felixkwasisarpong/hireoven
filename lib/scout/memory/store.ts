/**
 * Scout Memory Store — DB CRUD helpers
 *
 * All operations are user-scoped. Postgres RLS provides a second enforcement
 * layer, but every query here also filters by user_id explicitly.
 */

import type { Pool } from "pg"
import type {
  ScoutMemory,
  ScoutMemoryCategory,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryCandidate,
} from "./types"
import {
  VALID_MEMORY_CATEGORIES,
  VALID_MEMORY_SOURCES,
  MIN_AUTO_PERSIST_CONFIDENCE,
  MAX_MEMORIES_PER_USER,
} from "./types"

// ── Row shape returned by Postgres ────────────────────────────────────────────

type MemoryRow = {
  id:         string
  category:   string
  summary:    string
  confidence: number
  source:     string
  active:     boolean
  created_at: string
  updated_at: string
}

function rowToMemory(row: MemoryRow): ScoutMemory {
  return {
    id:         row.id,
    category:   row.category as ScoutMemory["category"],
    summary:    row.summary,
    confidence: row.confidence,
    source:     row.source as ScoutMemory["source"],
    active:     row.active,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  }
}

// ── Auto-create table if migration hasn't been run ───────────────────────────

let tableEnsured = false

async function ensureTable(pool: Pool): Promise<void> {
  if (tableEnsured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scout_memories (
      id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      category     TEXT        NOT NULL CHECK (category IN (
        'career_goal','role_preference','company_preference','visa_requirement',
        'salary_preference','workflow_pattern','resume_preference',
        'interview_pattern','search_preference','skill_focus'
      )),
      summary      TEXT        NOT NULL CHECK (char_length(summary) BETWEEN 4 AND 300),
      confidence   FLOAT       NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
      source       TEXT        NOT NULL DEFAULT 'explicit_user' CHECK (source IN (
        'explicit_user','behavior','workflow','search_history'
      )),
      active       BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  tableEnsured = true
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Fetch all memories for a user, newest first. Pass active=true to skip disabled. */
export async function getMemories(
  userId: string,
  pool: Pool,
  opts: { activeOnly?: boolean } = {},
): Promise<ScoutMemory[]> {
  await ensureTable(pool)

  const where = opts.activeOnly
    ? "WHERE user_id = $1 AND active = TRUE"
    : "WHERE user_id = $1"

  const result = await pool.query<MemoryRow>(
    `SELECT id, category, summary, confidence, source, active, created_at, updated_at
     FROM scout_memories
     ${where}
     ORDER BY confidence DESC, updated_at DESC
     LIMIT 100`,
    [userId],
  )
  return result.rows.map(rowToMemory)
}

/** Fetch active memories for a specific category. */
export async function getMemoriesByCategory(
  userId: string,
  category: ScoutMemoryCategory,
  pool: Pool,
): Promise<ScoutMemory[]> {
  const result = await pool.query<MemoryRow>(
    `SELECT id, category, summary, confidence, source, active, created_at, updated_at
     FROM scout_memories
     WHERE user_id = $1 AND category = $2 AND active = TRUE
     ORDER BY confidence DESC, updated_at DESC`,
    [userId, category],
  )
  return result.rows.map(rowToMemory)
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Create a single memory. Returns null if category/source is invalid. */
export async function createMemory(
  userId: string,
  pool: Pool,
  input: CreateMemoryInput,
): Promise<ScoutMemory | null> {
  await ensureTable(pool)

  if (!VALID_MEMORY_CATEGORIES.has(input.category)) return null
  const source = input.source ?? "explicit_user"
  if (!VALID_MEMORY_SOURCES.has(source)) return null

  const summary = input.summary.trim()
  if (summary.length < 4 || summary.length > 300) return null

  const confidence = Math.max(0, Math.min(1, input.confidence ?? 0.8))

  // Enforce per-user cap
  const countRes = await pool.query<{ cnt: number }>(
    "SELECT COUNT(*)::int AS cnt FROM scout_memories WHERE user_id = $1",
    [userId],
  )
  if ((countRes.rows[0]?.cnt ?? 0) >= MAX_MEMORIES_PER_USER) return null

  const result = await pool.query<MemoryRow>(
    `INSERT INTO scout_memories (user_id, category, summary, confidence, source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, category, summary, confidence, source, active, created_at, updated_at`,
    [userId, input.category, summary, confidence, source],
  )
  const row = result.rows[0]
  return row ? rowToMemory(row) : null
}

/** Update summary, confidence, or active flag on an existing memory. */
export async function updateMemory(
  id: string,
  userId: string,
  pool: Pool,
  patch: UpdateMemoryInput,
): Promise<ScoutMemory | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 3

  if (patch.summary !== undefined) {
    const s = patch.summary.trim()
    if (s.length < 4 || s.length > 300) return null
    sets.push(`summary = $${idx++}`)
    values.push(s)
  }
  if (patch.confidence !== undefined) {
    sets.push(`confidence = $${idx++}`)
    values.push(Math.max(0, Math.min(1, patch.confidence)))
  }
  if (patch.active !== undefined) {
    sets.push(`active = $${idx++}`)
    values.push(patch.active)
  }
  if (sets.length === 0) return null

  const result = await pool.query<MemoryRow>(
    `UPDATE scout_memories
     SET ${sets.join(", ")}
     WHERE id = $1 AND user_id = $2
     RETURNING id, category, summary, confidence, source, active, created_at, updated_at`,
    [id, userId, ...values],
  )
  const row = result.rows[0]
  return row ? rowToMemory(row) : null
}

/** Permanently delete a memory. */
export async function deleteMemory(
  id: string,
  userId: string,
  pool: Pool,
): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM scout_memories WHERE id = $1 AND user_id = $2",
    [id, userId],
  )
  return (result.rowCount ?? 0) > 0
}

/** Disable all memories for a user (bulk opt-out). Does not delete. */
export async function disableAllMemories(
  userId: string,
  pool: Pool,
): Promise<void> {
  await pool.query(
    "UPDATE scout_memories SET active = FALSE WHERE user_id = $1",
    [userId],
  )
}

// ── Deduplication-aware upsert ────────────────────────────────────────────────

/**
 * Attempt to persist a batch of extracted candidates.
 *
 * Deduplication logic:
 *   - If an active memory in the same category has a very similar summary
 *     (normalised overlap > 60%), skip insertion.
 *   - If a disabled memory with higher confidence exists, skip.
 *   - Otherwise insert.
 *
 * Returns how many were actually written.
 */
export async function persistCandidates(
  userId: string,
  pool: Pool,
  candidates: MemoryCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0
  await ensureTable(pool)

  // Fetch existing memories for affected categories
  const categories = [...new Set(candidates.map((c) => c.category))]
  const existing = await pool.query<MemoryRow>(
    `SELECT id, category, summary, confidence, source, active, created_at, updated_at
     FROM scout_memories
     WHERE user_id = $1 AND category = ANY($2)`,
    [userId, categories],
  )
  const existingRows = existing.rows.map(rowToMemory)

  let written = 0
  for (const candidate of candidates) {
    if ((candidate.confidence ?? 0.8) < MIN_AUTO_PERSIST_CONFIDENCE) continue

    const similar = existingRows.filter(
      (m) =>
        m.category === candidate.category &&
        summarySimilarity(m.summary, candidate.summary) > 0.6,
    )

    if (similar.length > 0) {
      // Update confidence if the new candidate is more confident
      const best = similar.sort((a, b) => b.confidence - a.confidence)[0]
      const newConf = candidate.confidence ?? 0.8
      if (newConf > best.confidence + 0.1 && best.active) {
        await pool.query(
          "UPDATE scout_memories SET confidence = $1 WHERE id = $2 AND user_id = $3",
          [newConf, best.id, userId],
        )
      }
      continue
    }

    const created = await createMemory(userId, pool, candidate)
    if (created) {
      existingRows.push(created)
      written++
    }
  }
  return written
}

// ── Similarity helper (normalised word-overlap Jaccard) ───────────────────────

function tokenise(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  )
}

function summarySimilarity(a: string, b: string): number {
  const ta = tokenise(a)
  const tb = tokenise(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  for (const w of ta) if (tb.has(w)) intersection++
  return intersection / (ta.size + tb.size - intersection)
}
