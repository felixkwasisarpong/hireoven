import { getPostgresPool } from "@/lib/postgres/server"
import { atsIdentifierKey, atsIdentifierKeySql } from "@/lib/companies/ats-identifier-key"

/**
 * Find the company that owns an ATS board, following duplicate flags.
 *
 * Discovery paths used to look this up with `AND duplicate_of_company_id IS NULL`
 * and insert a fresh company when it found nothing. That is a duplicate factory:
 * flagging a row as a duplicate does not merge it, so a board whose only records
 * were all flagged looked unclaimed to every subsystem that checked — and there
 * were 1,534 such groups, some with no canonical row at all. Each new subsystem
 * then minted its own synthetic domain (`<id>.<ats>-discovered`, `-tenant`,
 * `-scout`), which never collided with the others on the domain unique key, so
 * one employer accumulated a record per subsystem that ever saw it.
 *
 * Resolving through the flag instead means a flagged record still answers for its
 * board — it points at the survivor rather than pretending the board is unclaimed.
 */
/** Anything that can run a parameterised query — a Pool, a client, or a test double. */
type Queryable = {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>
}

export async function findCompanyIdByAtsPair(
  atsType: string | null | undefined,
  atsIdentifier: string | null | undefined,
  db?: Queryable,
): Promise<string | null> {
  if (!atsType?.trim() || !atsIdentifier?.trim()) return null

  const type = atsType.trim()
  const identifier = atsIdentifier.trim()
  const query = db ?? getPostgresPool()

  const exact = await query.query<{ id: string }>(
    `SELECT COALESCE(c.duplicate_of_company_id, c.id) AS id
       FROM companies c
      WHERE c.ats_type = $1 AND c.ats_identifier = $2
      ORDER BY (c.duplicate_of_company_id IS NULL) DESC, c.created_at ASC
      LIMIT 1`,
    [type, identifier],
  )
  if (exact.rows[0]?.id) return exact.rows[0].id

  // Exact match missed, but the same board may already be claimed under a
  // different spelling — the slash form vs the adapter slug, a different Workday
  // datacentre segment, or just different casing. Comparing on a canonical key
  // catches those. This runs only when the indexed exact lookup finds nothing,
  // so the common path is unchanged.
  const key = atsIdentifierKey(type, identifier)
  if (!key) return null

  const canonical = await query.query<{ id: string }>(
    `SELECT COALESCE(c.duplicate_of_company_id, c.id) AS id
       FROM companies c
      WHERE c.ats_type = $1
        AND c.ats_identifier IS NOT NULL
        AND ${atsIdentifierKeySql("c.ats_identifier", type)} = $2
      ORDER BY (c.duplicate_of_company_id IS NULL) DESC, c.created_at ASC
      LIMIT 1`,
    [type, key],
  )

  return canonical.rows[0]?.id ?? null
}

/**
 * ATS pair already recorded for a domain, if we hold one.
 *
 * Lets the Career Site Scout reuse a board coordinate we already know rather than
 * probing for it — the only practical route to ATSes whose identifier cannot be
 * guessed from a name (Workday needs `tenant:wd5:Site`, Oracle a pod and a site).
 * Callers must still corroborate it against the domain: records get mis-attached,
 * and `cloudflare.com` is stored here as `greenhouse/builtin`.
 */
export async function findAtsPairForDomain(
  domain: string | null | undefined,
  db?: Queryable,
): Promise<{ atsType: string; atsIdentifier: string } | null> {
  if (!domain?.trim()) return null

  const { rows } = await (db ?? getPostgresPool()).query<{ ats_type: string; ats_identifier: string }>(
    `SELECT ats_type, ats_identifier
       FROM companies
      WHERE domain = $1
        AND ats_type IS NOT NULL
        AND ats_identifier IS NOT NULL
      ORDER BY (duplicate_of_company_id IS NULL) DESC, is_active DESC, created_at ASC
      LIMIT 1`,
    [domain.trim().toLowerCase()],
  )

  const row = rows[0]
  return row ? { atsType: row.ats_type, atsIdentifier: row.ats_identifier } : null
}
