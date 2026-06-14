/**
 * One-shot backfill: fetch real job descriptions for existing Workable jobs that
 * landed with a stub. Workable's v3 list API returns an EMPTY description for many
 * boards; the full JD only comes from the v2 detail endpoint
 * (/api/v2/accounts/{slug}/jobs/{shortcode}). Jobs harvested before the adapter
 * detail-fetch fix (PR #193) are stuck on ~255-char enrichment-fallback stubs,
 * and the harvester won't re-fetch them (length >= 200 → "already described").
 *
 * For each candidate this fetches the full JD, re-runs the deterministic
 * normalizer (so skills / seniority / normalized_title get re-extracted), and
 * updates the row.
 *
 *   npx tsx scripts/backfill-workable-descriptions.ts                    # dry-run
 *   npx tsx scripts/backfill-workable-descriptions.ts --execute
 *   npx tsx scripts/backfill-workable-descriptions.ts --execute --limit=2000
 *
 * Idempotent — re-runs only touch jobs still under the min-length threshold.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { hashContent, conditionalFetchJson } from "@/lib/harvester/adapters/_base"
import { getPostgresPool } from "@/lib/postgres/server"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { publicationStatusForJob } from "@/lib/jobs/publication"
import { safeJsonStringify } from "@/lib/jobs/json-sanitize"
import type { EmploymentType } from "@/types"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const getArg = (p: string) => args.find((a) => a.startsWith(p))?.split("=")[1]
const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "4", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "700", 10))
const delayMs = Math.max(0, Number.parseInt(getArg("--delay-ms=") ?? "150", 10))

type CandidateRow = {
  job_id: string
  job_title: string
  job_apply_url: string
  job_location: string | null
  job_description: string | null
  job_external_id: string
  job_employment_type: string | null
  job_first_detected_at: string | null
  job_raw_data: Record<string, unknown> | null
  company_ats_identifier: string | null
}

type WorkableDetail = { description?: string; requirements?: string; benefits?: string }

function stripHtml(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const text = value
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
  return text || undefined
}

function buildDescription(detail: WorkableDetail): string | undefined {
  const segments = [detail.description, detail.requirements, detail.benefits]
    .map((s) => stripHtml(s))
    .filter((s): s is string => Boolean(s))
  return segments.length ? segments.join("\n\n") : undefined
}

function parseSlug(applyUrl: string, atsIdentifier: string | null): string | null {
  if (atsIdentifier?.trim()) return atsIdentifier.trim()
  try {
    return new URL(applyUrl).pathname.split("/").filter(Boolean)[0] || null
  } catch {
    return null
  }
}

function parseShortcode(externalId: string): string | null {
  const m = externalId.match(/^workable:(.+)$/)
  return m ? m[1].trim() : null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function main() {
  console.log(`[backfill-workable] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} min-length=${minLength}`)
  const pool = getPostgresPool()
  // source_ats isn't indexed (a filter on it seq-scans ~2.3M jobs and can OOM the
  // web box). Scope by the workable companies' ids instead — company_id IS indexed.
  const { rows: companyRows } = await pool.query<{ id: string; ats_identifier: string | null }>(
    `SELECT id, ats_identifier FROM companies WHERE ats_type = 'workable' AND is_active = true`
  )
  const companyIds = companyRows.map((c) => c.id)
  const atsIdById = new Map(companyRows.map((c) => [c.id, c.ats_identifier]))
  if (companyIds.length === 0) { console.log("[backfill-workable] no workable companies"); await pool.end(); return }

  const { rows: jobRows } = await pool.query<Omit<CandidateRow, "company_ats_identifier"> & { company_id: string }>(
    `SELECT j.id AS job_id, j.title AS job_title, j.apply_url AS job_apply_url,
            j.location AS job_location, j.description AS job_description,
            j.external_id AS job_external_id, j.employment_type AS job_employment_type,
            j.first_detected_at AS job_first_detected_at, j.raw_data AS job_raw_data,
            j.company_id AS company_id
       FROM jobs j
      WHERE j.company_id = ANY($1::uuid[]) AND j.is_active = true AND j.closed_at IS NULL
        AND j.source_ats = 'workable'
        AND (j.description IS NULL OR length(j.description) < $3)
      ORDER BY j.first_detected_at DESC NULLS LAST
      LIMIT $2`,
    [companyIds, limit, minLength]
  )
  const candidates: CandidateRow[] = jobRows.map((j) => ({ ...j, company_ats_identifier: atsIdById.get(j.company_id) ?? null }))
  console.log(`[backfill-workable] candidates: ${candidates.length}`)

  let updated = 0, unchanged = 0, fetchFailed = 0, skipped = 0
  const sampleHits: string[] = []
  const limiter = pLimit(concurrency)

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        if (delayMs > 0) await sleep(Math.random() * delayMs)
        const slug = parseSlug(row.job_apply_url, row.company_ats_identifier)
        const shortcode = parseShortcode(row.job_external_id)
        if (!slug || !shortcode) { skipped += 1; return }

        const url = `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(shortcode)}`
        const res = await conditionalFetchJson<WorkableDetail>(url, { etag: null, lastModified: null, timeoutMs: 12_000 }, { maxAttempts: 2 })
        if (res.kind !== "ok" || !res.data) { fetchFailed += 1; return }

        const newDescription = buildDescription(res.data)
        if (!newDescription || newDescription.length <= (row.job_description?.length ?? 0)) { unchanged += 1; return }

        // Re-normalize to re-extract skills/seniority/normalized_title from the full JD.
        const norm = normalizePersistedJobRecord({
          id: row.job_id,
          title: row.job_title,
          normalized_title: null,
          location: row.job_location,
          apply_url: row.job_apply_url,
          external_id: row.job_external_id,
          description: newDescription,
          employment_type: (row.job_employment_type as EmploymentType | null) ?? null,
          seniority_level: null,
          is_remote: false,
          is_hybrid: false,
          salary_min: null,
          salary_max: null,
          salary_currency: "USD",
          sponsors_h1b: null,
          sponsorship_score: 0,
          requires_authorization: false,
          visa_language_detected: null,
          skills: [],
          first_detected_at: row.job_first_detected_at ?? new Date().toISOString(),
          raw_data: row.job_raw_data ?? { source: "workable" },
        })
        const nc = norm.nextColumns
        const publicationStatus = publicationStatusForJob({ description: nc.description, skills: nc.skills })
        const contentHash = hashContent([row.job_title, row.job_apply_url, row.job_location, nc.description?.slice(0, 4_000)])
        const rawData = safeJsonStringify({
          ...(row.job_raw_data ?? {}),
          source: "workable",
          description_backfill: { via: "workable-v2-detail", at: new Date().toISOString() },
          normalized: norm.canonical,
          structured_job: norm.structuredData,
          view: { page: norm.pageView, card: norm.cardView },
        })

        if (sampleHits.length < 12) {
          sampleHits.push(`  ${row.job_title.slice(0, 40).padEnd(40)} ${row.job_description?.length ?? 0} -> ${nc.description?.length ?? 0} ch | skills ${(nc.skills ?? []).length}`)
        }
        if (dryRun) { updated += 1; return }

        await pool.query(
          `UPDATE jobs SET description=$2, normalized_title=$3, seniority_level=$4, skills=$5,
                  publication_status=$6, raw_data=$7::jsonb, content_hash=decode($8,'hex'), updated_at=now()
            WHERE id=$1`,
          [row.job_id, nc.description, nc.normalized_title, nc.seniority_level, nc.skills, publicationStatus, rawData, contentHash]
        )
        updated += 1
      })
    )
  )

  console.log(`[backfill-workable] ${dryRun ? "would-update" : "updated"}=${updated} unchanged=${unchanged} fetchFailed=${fetchFailed} skipped=${skipped}`)
  if (sampleHits.length) { console.log("sample (before -> after):"); for (const s of sampleHits) console.log(s) }
  await pool.end()
}

main().catch((e) => { console.error("[backfill-workable] fatal:", e); process.exit(1) })
