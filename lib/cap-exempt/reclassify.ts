import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { classifyCapExempt } from "./classify"

// Re-run the cap-exempt classifier over all companies in keyset batches. Idempotent:
// only rows whose classification changed are updated.
export async function reclassifyAllCapExempt(): Promise<{
  scanned: number
  changed: number
  cap_exempt_total: number
}> {
  if (!hasPostgresEnv()) return { scanned: 0, changed: 0, cap_exempt_total: 0 }
  const pool = getPostgresPool()
  const BATCH = 1000
  let lastId = "00000000-0000-0000-0000-000000000000"
  let scanned = 0
  let changed = 0

  for (;;) {
    const { rows } = await pool.query<{
      id: string
      name: string
      domain: string | null
      industry: string | null
      is_cap_exempt: boolean
      cap_exempt_reason: string | null
      cap_exempt_confidence: string | null
      cap_exempt_source: string | null
    }>(
      `SELECT id, name, domain, industry, is_cap_exempt, cap_exempt_reason, cap_exempt_confidence, cap_exempt_source
       FROM companies WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, BATCH]
    )
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id
    scanned += rows.length

    const upd: Array<{ id: string; ce: boolean; reason: string | null; conf: string | null; src: string | null }> = []
    for (const r of rows) {
      const c = classifyCapExempt({ name: r.name, domain: r.domain, industry: r.industry })
      if (
        c.is_cap_exempt !== r.is_cap_exempt ||
        (c.reason ?? null) !== (r.cap_exempt_reason ?? null) ||
        (c.confidence ?? null) !== (r.cap_exempt_confidence ?? null) ||
        (c.source ?? null) !== (r.cap_exempt_source ?? null)
      ) {
        upd.push({ id: r.id, ce: c.is_cap_exempt, reason: c.reason, conf: c.confidence, src: c.source })
      }
    }

    if (upd.length > 0) {
      await pool.query(
        `UPDATE companies c SET
           is_cap_exempt = m.ce,
           cap_exempt_reason = m.reason,
           cap_exempt_confidence = m.conf,
           cap_exempt_source = m.src,
           cap_exempt_verified_at = NOW()
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::boolean[]) AS ce,
                      unnest($3::text[]) AS reason, unnest($4::text[]) AS conf, unnest($5::text[]) AS src) m
         WHERE c.id = m.id`,
        [upd.map((u) => u.id), upd.map((u) => u.ce), upd.map((u) => u.reason), upd.map((u) => u.conf), upd.map((u) => u.src)]
      )
      changed += upd.length
    }
  }

  const { rows: tot } = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM companies WHERE is_cap_exempt = true"
  )
  return { scanned, changed, cap_exempt_total: Number(tot[0]?.n ?? 0) }
}
