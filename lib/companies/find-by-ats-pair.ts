import { getPostgresPool } from "@/lib/postgres/server"

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

  const { rows } = await (db ?? getPostgresPool()).query<{ id: string }>(
    `SELECT COALESCE(c.duplicate_of_company_id, c.id) AS id
       FROM companies c
      WHERE c.ats_type = $1 AND c.ats_identifier = $2
      ORDER BY (c.duplicate_of_company_id IS NULL) DESC, c.created_at ASC
      LIMIT 1`,
    [atsType.trim(), atsIdentifier.trim()],
  )

  return rows[0]?.id ?? null
}
