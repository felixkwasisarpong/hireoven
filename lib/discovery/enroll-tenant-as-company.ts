/**
 * Enroll a resolved ATS tenant as a harvestable company.
 *
 * The tenant registry (ats_tenants) is the source of truth for "an ATS board
 * exists"; companies is the harvestable unit. This bridges the two: it always
 * records/updates the tenant row, then links it to an existing company or
 * creates one, queued for immediate harvest.
 *
 * Dedup order (most → least specific):
 *   1. companies by (ats_type, ats_identifier)  — the real identity of a board
 *   2. companies by domain (companies_domain_key) — the existing unique key;
 *      enriches a pre-existing company row (e.g. an aggregator placeholder on
 *      the real domain) with the ATS pair via ON CONFLICT.
 *
 * NOTE ON ID TYPES: companies.id and ats_tenants.id are uuid (see schema.sql /
 * add-ats-tenants.sql), so companyId/tenantId are strings, not numbers.
 */

import type { Pool } from "pg"
import type { AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { counter } from "@/lib/observability/metrics"

export interface EnrollTenantInput {
  atsType: string
  atsIdentifier: string
  confidence: number
  jobCount?: number
  sourceUrl?: string
  sourceType?: string
  companyNameGuess?: string
  domainGuess?: string
  /** uuid of an ats_tenants row the caller already inserted (optional). */
  tenantId?: string
}

export interface EnrollResult {
  created: boolean
  companyId: string
  tenantId: string
  atsType: string
  atsIdentifier: string
}

/**
 * Canonical careers URL for an (atsType, slug). Delegates to the shared
 * canonicalCareersUrl (the inverse of adapter URL detection) and falls back to
 * the source URL, then a synthetic root, so companies.careers_url (NOT NULL) is
 * always satisfied.
 */
export function buildCareersUrl(
  atsType: string,
  atsIdentifier: string,
  sourceUrl?: string,
): string {
  const canonical = canonicalCareersUrl(atsType as AtsName, atsIdentifier)
  if (canonical) return canonical
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) return sourceUrl
  return `https://${atsIdentifier}.${atsType}-tenant`
}

function freshnessTierFor(jobCount: number | undefined): "tier_1" | "tier_2" | "tier_3" {
  const n = jobCount ?? 0
  if (n >= 50) return "tier_1"
  if (n >= 5) return "tier_2"
  return "tier_3"
}

export async function enrollTenantAsCompany(
  pool: Pool,
  input: EnrollTenantInput,
): Promise<EnrollResult> {
  const { atsType, atsIdentifier } = input

  // 1. Upsert the tenant row first — we always want a tenant record regardless
  //    of what happens to companies.
  const tenantRes = await pool.query<{ id: string }>(
    `INSERT INTO ats_tenants
       (ats_type, ats_identifier, source_url, source_type,
        company_name_guess, domain_guess, confidence, job_count,
        status, last_checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'discovered', now())
     ON CONFLICT (ats_type, ats_identifier) DO UPDATE
       SET source_url         = COALESCE(EXCLUDED.source_url, ats_tenants.source_url),
           source_type        = COALESCE(EXCLUDED.source_type, ats_tenants.source_type),
           company_name_guess = COALESCE(EXCLUDED.company_name_guess, ats_tenants.company_name_guess),
           domain_guess       = COALESCE(EXCLUDED.domain_guess, ats_tenants.domain_guess),
           confidence         = GREATEST(ats_tenants.confidence, EXCLUDED.confidence),
           job_count          = EXCLUDED.job_count,
           last_checked_at    = now(),
           updated_at         = now()
     RETURNING id`,
    [
      atsType,
      atsIdentifier,
      input.sourceUrl ?? null,
      input.sourceType ?? null,
      input.companyNameGuess ?? null,
      input.domainGuess ?? null,
      input.confidence,
      input.jobCount ?? 0,
    ],
  )
  const tenantId = tenantRes.rows[0]?.id ?? input.tenantId
  if (!tenantId) {
    throw new Error(`enrollTenantAsCompany: failed to upsert ats_tenants for ${atsType}/${atsIdentifier}`)
  }
  const sourceType = input.sourceType ?? "unknown"
  counter("tenant.upsert", { atsType, sourceType })
  counter("tenant.discovered", { atsType, sourceType })

  // 2. Existing company by the real ATS identity?
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM companies
      WHERE ats_type = $1 AND ats_identifier = $2
        AND duplicate_of_company_id IS NULL
      ORDER BY created_at ASC
      LIMIT 1`,
    [atsType, atsIdentifier],
  )

  // 3. Link the tenant to the existing company; no duplicate company created.
  if (existing.rows[0]) {
    const companyId = existing.rows[0].id
    await pool.query(
      `UPDATE ats_tenants SET status = 'enrolled', company_id = $1, updated_at = now() WHERE id = $2`,
      [companyId, tenantId],
    )
    counter("tenant.enrolled", { atsType, sourceType, created: "false" })
    return { created: false, companyId, tenantId, atsType, atsIdentifier }
  }

  // 4. No company for this ATS pair — insert one. The companies_domain_key
  //    unique constraint is the existing dedup: ON CONFLICT (domain) enriches a
  //    pre-existing row (e.g. a real-domain placeholder) with the ATS pair.
  const careersUrl = buildCareersUrl(atsType, atsIdentifier, input.sourceUrl)
  const domain = input.domainGuess ?? `${atsIdentifier}.${atsType}-tenant`
  const name = input.companyNameGuess ?? atsIdentifier
  const freshnessTier = freshnessTierFor(input.jobCount)
  const discoveredVia = `tenant:${input.sourceType ?? "unknown"}`

  const inserted = await pool.query<{ id: string; inserted: boolean }>(
    `INSERT INTO companies
       (name, domain, careers_url, ats_type, ats_identifier,
        is_active, status, freshness_tier, discovered_via, next_harvest_at,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, 'active', $6, $7, now(), now(), now())
     ON CONFLICT (domain) DO UPDATE
       SET ats_type        = COALESCE(companies.ats_type, EXCLUDED.ats_type),
           ats_identifier  = COALESCE(companies.ats_identifier, EXCLUDED.ats_identifier),
           is_active       = true,
           status          = CASE WHEN companies.status = 'inactive' THEN 'active' ELSE companies.status END,
           careers_url     = COALESCE(companies.careers_url, EXCLUDED.careers_url),
           next_harvest_at = LEAST(COALESCE(companies.next_harvest_at, now()), now()),
           updated_at      = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [name, domain, careersUrl, atsType, atsIdentifier, freshnessTier, discoveredVia],
  )

  const row = inserted.rows[0]
  if (!row) {
    throw new Error(`enrollTenantAsCompany: companies upsert returned no row for ${atsType}/${atsIdentifier}`)
  }

  // 5. Link the tenant to the (new or domain-matched) company.
  await pool.query(
    `UPDATE ats_tenants SET status = 'enrolled', company_id = $1, updated_at = now() WHERE id = $2`,
    [row.id, tenantId],
  )

  counter("tenant.enrolled", { atsType, sourceType, created: String(row.inserted) })
  return { created: row.inserted, companyId: row.id, tenantId, atsType, atsIdentifier }
}
