import { Pool } from "pg"

let pool: Pool | null = null

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL (or TARGET_POSTGRES_URL) is required for Postgres access")
  }

  return connectionString
}

/** True when app Postgres reads/writes are configured (self-hosted or other). */
export function hasPostgresEnv(): boolean {
  return Boolean(process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL)
}

export function getPostgresPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getConnectionString(),
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    })
  }

  return pool
}
