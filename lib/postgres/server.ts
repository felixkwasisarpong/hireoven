import { Pool } from "pg"

let pool: Pool | null = null

const TRANSIENT_POSTGRES_CODES = new Set([
  "53300", // too_many_connections
  "57P01", // admin_shutdown / terminated by administrator command
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
])

export function getPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

export function isTransientPostgresError(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return Boolean(code && (code.startsWith("08") || TRANSIENT_POSTGRES_CODES.has(code)))
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL (or TARGET_POSTGRES_URL) is required for Postgres access")
  }

  return connectionString
}

function shouldUseSsl(connectionString: string): boolean {
  const explicitMode = (process.env.PGSSLMODE ?? process.env.DATABASE_SSL ?? "").toLowerCase()
  if (explicitMode === "disable" || explicitMode === "false" || explicitMode === "0") return false
  if (explicitMode === "require" || explicitMode === "true" || explicitMode === "1") return true

  try {
    const sslMode = new URL(connectionString).searchParams.get("sslmode")?.toLowerCase()
    if (sslMode === "disable") return false
    if (sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca" || sslMode === "verify-full") {
      return true
    }
  } catch {
    // Fall back to existing production behavior if the connection string is not URL-parseable.
  }

  return process.env.NODE_ENV === "production"
}

/** True when app Postgres reads/writes are configured (self-hosted or other). */
export function hasPostgresEnv(): boolean {
  return Boolean(process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL)
}

export function getPostgresPool(): Pool {
  if (!pool) {
    const connectionString = getConnectionString()
    pool = new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX ?? 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
    pool.on("error", (error) => {
      console.error("[postgres] idle_client_error", {
        message: error.message,
        name: error.name,
      })
    })
  }

  return pool
}
