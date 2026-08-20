/**
 * Idempotent DB migration runner — applied automatically on app startup.
 *
 * Every scripts/migrations/*.sql is written `CREATE TABLE / ADD COLUMN IF NOT
 * EXISTS`, so applying them is safe and repeatable. This runner records what it
 * has applied in a `schema_migrations` table and skips those next time, so a
 * deploy converges the DB to the code's expected schema with no hand-applying —
 * which is what used to fall behind and 500 new features (positioning,
 * mine-transitions, …).
 *
 * Runs as plain Node (no tsx) because the Next standalone image ships only
 * server.js + traced node_modules. The Dockerfile CMD invokes this before
 * `node server.js`.
 *
 * `pg` is loaded through createRequire rather than `import pg from "pg"`. pg's
 * exports map sends an ESM import to ./esm/index.mjs, and Next's output file
 * tracing never copies that file — the traced app graph only ever reaches pg
 * through CJS, so the standalone image contains pg/lib and pg/package.json and
 * nothing else. The ESM import therefore resolved to a path that does not exist
 * in the image and every container start died with ERR_MODULE_NOT_FOUND,
 * silently skipping all migrations for as long as that went unnoticed (the CMD
 * swallows the failure by design so the app still boots). createRequire takes
 * the "require" condition instead, which resolves to pg/lib/index.js — the half
 * tracing does copy.
 *
 * Safety:
 *  - Bounded pg_try_advisory_lock so concurrent replicas/containers serialize
 *    (only one applies; others skip) and no instance blocks forever on startup.
 *  - Each migration runs in its own transaction; a failure rolls back and is
 *    retried on a later pass (migrations aren't numbered, so a dependency may
 *    only be satisfied after an earlier file in the same run).
 *  - Non-fatal by design at the CMD level (`|| echo …`): a migration problem is
 *    logged loudly but never blocks the app from starting.
 */

import { createRequire } from "node:module"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const pg = require("pg")

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(process.cwd(), "scripts", "migrations")
const LOCK_KEY = 8412764 // arbitrary, stable advisory-lock id for this runner
const LOCK_WAIT_MS = 45_000

const log = (...a) => console.log("[migrate]", ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sslFor(connectionString) {
  return /sslmode=require|sslmode=verify/i.test(connectionString) || process.env.PGSSLMODE === "require"
    ? { rejectUnauthorized: false }
    : false
}

async function connect(connectionString) {
  const ssl = sslFor(connectionString)
  let lastErr
  for (let i = 1; i <= 5; i++) {
    try {
      const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 10_000 })
      await client.connect()
      return client
    } catch (e) {
      lastErr = e
      log(`connect attempt ${i}/5 failed: ${e.message}`)
      if (i < 5) await sleep(2000 * i)
    }
  }
  throw lastErr
}

async function acquireLock(client) {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY])
    if (rows[0].ok) return true
    if (Date.now() > deadline) return false
    log("another instance holds the migration lock — waiting…")
    await sleep(1500)
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    log("DATABASE_URL not set — skipping migrations")
    return
  }
  if (!existsSync(MIGRATIONS_DIR)) {
    log(`migrations dir not found (${MIGRATIONS_DIR}) — skipping`)
    return
  }

  const client = await connect(connectionString)
  try {
    if (!(await acquireLock(client))) {
      log("could not acquire migration lock in time — another instance is applying; continuing startup")
      return
    }

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
    )
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
    let pending = files.filter((f) => !applied.has(f))

    if (pending.length === 0) {
      log(`up to date — ${files.length} migrations, 0 pending`)
      return
    }

    // Baseline mode: record current migrations as applied WITHOUT executing them.
    // Run once when introducing this runner against an already-caught-up DB, so
    // the pre-existing one-time data-fix migrations (backfill-*, fix-*, …) don't
    // re-run. After baselining, only genuinely-new files execute on deploy.
    if (process.env.MIGRATE_BASELINE === "1") {
      for (const f of pending) {
        const checksum = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, f), "utf8")).digest("hex").slice(0, 16)
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING",
          [f, checksum],
        )
      }
      log(`baselined ${pending.length} migration(s) as applied WITHOUT executing`)
      return
    }

    log(`${pending.length} pending of ${files.length}`)

    const lastErr = {}
    // Multi-pass: retry failures while any progress is made (dependency order).
    for (;;) {
      const stillPending = []
      let progressed = false
      for (const f of pending) {
        const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8")
        const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16)
        try {
          await client.query("BEGIN")
          await client.query("SET LOCAL statement_timeout = '180s'")
          await client.query(sql)
          await client.query(
            "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING",
            [f, checksum],
          )
          await client.query("COMMIT")
          log(`✓ ${f}`)
          progressed = true
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {})
          lastErr[f] = e.message
          stillPending.push(f)
        }
      }
      pending = stillPending
      if (!pending.length || !progressed) break
    }

    if (pending.length) {
      log(`FAILED to apply ${pending.length} migration(s):`)
      for (const f of pending) log(`  ✗ ${f}: ${lastErr[f]}`)
      process.exitCode = 1 // visible in CI/logs; CMD keeps the app starting anyway
    } else {
      log("all pending migrations applied")
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {})
    await client.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error("[migrate] fatal:", e.message)
  process.exit(1)
})
