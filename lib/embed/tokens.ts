import { randomBytes, createHash } from "crypto"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

// Embed-token layer (Spec 07). A token is OPTIONAL on a widget URL — public
// widgets render with attribution for anyone. A valid token tied to a paid tier
// is the only way to suppress the "Powered by Hireoven" footer. Free-tier tokens
// (and the no-token default) always show attribution; this is enforced here on the
// server, never trusted from a query param.

export type EmbedTier = "free" | "pro" | "whitelabel"

export interface EmbedTokenRecord {
  id: string
  signalKeyId: string
  tier: EmbedTier
  label: string | null
  showAttribution: boolean
  allowedOrigins: string[] | null
}

interface Row {
  id: string
  signal_key_id: string
  tier: string
  label: string | null
  show_attribution: boolean
  allowed_origins: string[] | null
}

function mapRow(r: Row): EmbedTokenRecord {
  const tier: EmbedTier = r.tier === "pro" || r.tier === "whitelabel" ? r.tier : "free"
  return {
    id: r.id,
    signalKeyId: r.signal_key_id,
    tier,
    label: r.label,
    // Hard rule: free tier can NEVER suppress attribution regardless of the column.
    showAttribution: tier === "free" ? true : r.show_attribution,
    allowedOrigins: r.allowed_origins && r.allowed_origins.length ? r.allowed_origins : null,
  }
}

// Resolve a token to its tier/attribution. Returns null for missing/invalid/revoked
// tokens — callers treat that as the free, attribution-on default (never a hard error,
// so a bad token degrades gracefully instead of breaking the embed).
export async function resolveEmbedToken(token: string | null | undefined): Promise<EmbedTokenRecord | null> {
  if (!token || !hasPostgresEnv()) return null
  try {
    const { rows } = await getPostgresPool().query<Row>(
      `SELECT id::text, signal_key_id::text, tier, label, show_attribution, allowed_origins
         FROM embed_tokens
        WHERE token = $1 AND is_active = true AND revoked_at IS NULL
        LIMIT 1`,
      [token]
    )
    return rows[0] ? mapRow(rows[0]) : null
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === "42P01" || code === "42703") return null
    throw e
  }
}

// Whether a resolved token permits the given referer origin. No allowlist = any origin.
export function originAllowed(rec: EmbedTokenRecord | null, refererDomain: string | null): boolean {
  if (!rec || !rec.allowedOrigins) return true
  if (!refererDomain) return false
  return rec.allowedOrigins.some((o) => o === refererDomain || refererDomain.endsWith(`.${o}`))
}

export function newEmbedToken(): string {
  return `emb_${randomBytes(18).toString("base64url")}`
}

export function hashSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}

// --- Partner CRUD (Signal API) ---------------------------------------------

export async function createEmbedToken(input: {
  signalKeyId: string
  tier?: EmbedTier
  label?: string | null
  showAttribution?: boolean
  allowedOrigins?: string[] | null
}): Promise<{ token: string; record: EmbedTokenRecord }> {
  const pool = getPostgresPool()
  const tier: EmbedTier = input.tier ?? "free"
  const token = newEmbedToken()
  const { rows } = await pool.query<Row>(
    `INSERT INTO embed_tokens (signal_key_id, token, tier, label, show_attribution, allowed_origins)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     RETURNING id::text, signal_key_id::text, tier, label, show_attribution, allowed_origins`,
    [
      input.signalKeyId,
      token,
      tier,
      input.label ?? null,
      tier === "free" ? true : input.showAttribution ?? false,
      input.allowedOrigins && input.allowedOrigins.length ? input.allowedOrigins : null,
    ]
  )
  return { token, record: mapRow(rows[0]) }
}

export async function listEmbedTokens(signalKeyId: string): Promise<Array<EmbedTokenRecord & { token: string; createdAt: string }>> {
  const { rows } = await getPostgresPool().query<Row & { token: string; created_at: string }>(
    `SELECT id::text, signal_key_id::text, token, tier, label, show_attribution, allowed_origins, created_at
       FROM embed_tokens
      WHERE signal_key_id = $1::uuid AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [signalKeyId]
  )
  return rows.map((r) => ({ ...mapRow(r), token: r.token, createdAt: new Date(r.created_at).toISOString() }))
}

// Revoke a token, scoped to the owning Signal API key (so a partner can only revoke
// their own). Returns true if a row was revoked.
export async function revokeEmbedToken(id: string, signalKeyId: string): Promise<boolean> {
  const { rowCount } = await getPostgresPool().query(
    `UPDATE embed_tokens SET is_active = false, revoked_at = now()
      WHERE id = $1::uuid AND signal_key_id = $2::uuid AND revoked_at IS NULL`,
    [id, signalKeyId]
  )
  return (rowCount ?? 0) > 0
}
