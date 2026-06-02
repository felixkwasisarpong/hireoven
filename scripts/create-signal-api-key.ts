/**
 * Create a Signal API key (hash-only storage).
 *
 * Usage:
 *   npx tsx scripts/create-signal-api-key.ts --tenant=acme --name="Acme prod key" --execute
 *   npx tsx scripts/create-signal-api-key.ts --tenant=acme --name="Acme sandbox" --scopes=signals.read,feedback.write --default-user-id=<uuid> --execute
 *
 * Notes:
 * - Without --execute, this runs in dry-run mode and prints what would be inserted.
 * - Raw API key is printed once; store it securely.
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { createSignalApiKey } from "../lib/signal-api/key-material"

loadEnvConfig(process.cwd())

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const tenantId = (flag("tenant") ?? process.env.APEX_SIGNAL_API_DEFAULT_TENANT_ID ?? "default").trim()
const name = (flag("name") ?? "Signal API key").trim()
const scopesRaw = (flag("scopes") ?? "").trim()
const defaultUserId = (flag("default-user-id") ?? "").trim() || null
const expiresDays = Number.parseInt(flag("expires-days") ?? "", 10)

function parseScopes(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  }
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

async function main() {
  if (!tenantId) throw new Error("--tenant is required")
  if (!name) throw new Error("--name is required")
  if (defaultUserId && !UUID_RE.test(defaultUserId)) {
    throw new Error("--default-user-id must be a valid UUID")
  }

  const scopes = parseScopes(scopesRaw)
  const { rawKey, keyPrefix, keyHash } = createSignalApiKey()
  const expiresAt =
    Number.isFinite(expiresDays) && expiresDays > 0
      ? new Date(Date.now() + expiresDays * 86_400_000).toISOString()
      : null

  console.log("")
  console.log("── Create Signal API Key ─────────────────────────────")
  console.log(`tenant:        ${tenantId}`)
  console.log(`name:          ${name}`)
  console.log(`scopes:        ${scopes.length > 0 ? scopes.join(", ") : "(all scopes)"}`)
  console.log(`default user:  ${defaultUserId ?? "(none)"}`)
  console.log(`expires at:    ${expiresAt ?? "(never)"}`)
  console.log(`mode:          ${execute ? "EXECUTE" : "DRY RUN"}`)
  console.log("──────────────────────────────────────────────────────")
  console.log("")

  if (!execute) {
    console.log("Dry run complete. Re-run with --execute to persist the key hash.")
    return
  }

  const pool = getPool()
  try {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO signal_api_keys (
         tenant_id,
         name,
         key_hash,
         key_prefix,
         scopes,
         default_user_id,
         expires_at,
         metadata
       ) VALUES (
         $1, $2, $3, $4, $5::text[], $6::uuid, $7::timestamptz,
         jsonb_build_object('source', 'script:create-signal-api-key')
       )
       RETURNING id`,
      [tenantId, name, keyHash, keyPrefix, scopes, defaultUserId, expiresAt]
    )

    console.log("✅ Key created")
    console.log(`id:            ${inserted.rows[0]?.id ?? "(unknown)"}`)
    console.log(`prefix:        ${keyPrefix}`)
    console.log("")
    console.log("⚠️  Save this key now. It will not be shown again.")
    console.log(`x-api-key: ${rawKey}`)
    console.log("")
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : null

    if (code === "42P01" || code === "42703") {
      console.error("signal_api_keys table is missing. Run:")
      console.error("  psql \"$DATABASE_URL\" -f scripts/migrations/add-signal-api-keys.sql")
      return
    }
    throw error
  } finally {
    await pool.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error("create-signal-api-key failed:", err)
  process.exit(1)
})
