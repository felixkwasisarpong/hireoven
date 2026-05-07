/**
 * Upsert curated trending tech companies from company seeds.
 *
 * Usage:
 *   npx tsx scripts/seed-trending-tech-companies.ts
 *   npx tsx scripts/seed-trending-tech-companies.ts --execute
 *
 * Requires: DATABASE_URL (or TARGET_POSTGRES_URL) in .env.local
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"
import {
  COMPANY_SEED_ROWS,
  type CompanySize,
  type SeedExtra,
} from "./data/company-seeds"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const reportPathArg = process.argv.find((arg) => arg.startsWith("--report="))?.split("=")[1]
const reportPath =
  reportPathArg ??
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `trending-tech-seed-report-${new Date().toISOString().slice(0, 10)}.json`
  )

type SeedTuple =
  | readonly [string, string, string, string, CompanySize]
  | readonly [string, string, string, string, CompanySize, SeedExtra]

type InsertRow = {
  name: string
  domain: string
  careers_url: string
  logo_url: string | null
  industry: string | null
  size: CompanySize | null
  ats_type: string | null
  ats_identifier: string | null
  sponsors_h1b: boolean
  sponsorship_confidence: number
}

const TRENDING_TECH_DOMAINS = [
  "x.ai",
  "mistral.ai",
  "ssi.inc",
  "thinkingmachines.ai",
  "worldlabs.ai",
  "cognition.ai",
  "windsurf.com",
  "sierra.ai",
  "decagon.ai",
  "skild.ai",
  "groq.com",
  "together.ai",
  "fireworks.ai",
  "baseten.co",
  "lambda.ai",
  "writer.com",
  "suno.com",
  "pika.art",
  "elevenlabs.io",
  "runwayml.com",
  "figure.ai",
  "hebbia.ai",
  "crusoe.ai",
  "vastdata.com",
  "vannevarlabs.com",
  "abridge.com",
  "poolside.ai",
  "adept.ai",
  "mosaicml.com",
  "octoml.ai",
  "langchain.com",
  "mercor.com",
  "anduril.com",
  "shield.ai",
  "appliedintuition.com",
  "rebelliondefense.com",
  "wayve.ai",
  "waabi.ai",
  "synthesia.io",
  "runpod.io",
  "modal.com",
  "wandb.ai",
  "replicate.com",
  "pinecone.io",
  "motherduck.com",
] as const

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
}

function rowFromTuple(row: SeedTuple): InsertRow {
  const extra: SeedExtra = row.length > 5 ? (row[5] as SeedExtra) : {}
  const sponsors = extra.sponsors_h1b ?? false
  const confidence =
    typeof extra.sponsorship_confidence === "number"
      ? extra.sponsorship_confidence
      : sponsors
      ? 65
      : 35

  return {
    name: row[0],
    domain: normalizeDomain(row[1]),
    careers_url: row[2],
    industry: row[3],
    size: row[4],
    logo_url: companyLogoUrlFromDomain(row[1], "google-favicon"),
    ats_type: extra.ats_type ?? null,
    ats_identifier: extra.ats_identifier ?? null,
    sponsors_h1b: sponsors,
    sponsorship_confidence: confidence,
  }
}

function writeReport(payload: unknown): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  console.log(`[trending-tech] report: ${reportPath}`)
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL) in .env.local")
  }

  const seedMap = new Map<string, InsertRow>()
  for (const tuple of COMPANY_SEED_ROWS) {
    const row = rowFromTuple(tuple as SeedTuple)
    seedMap.set(row.domain, row)
  }

  const missingFromSeed = TRENDING_TECH_DOMAINS.filter((d) => !seedMap.has(d))
  if (missingFromSeed.length > 0) {
    throw new Error(`Trending domains missing from company seeds: ${missingFromSeed.join(", ")}`)
  }

  const rows = TRENDING_TECH_DOMAINS.map((d) => seedMap.get(d)!).filter(Boolean)
  const nowIso = new Date().toISOString()

  const report = {
    mode: execute ? "execute" : "dry-run",
    started_at: nowIso,
    domains_total: TRENDING_TECH_DOMAINS.length,
    selected_rows: rows.length,
    inserted: 0,
    updated: 0,
    changed: [] as Array<Record<string, unknown>>,
  }

  console.log(
    `\n[trending-tech] mode=${execute ? "EXECUTE" : "dry-run"} domains=${rows.length}\n`
  )

  if (!execute) {
    const preview = rows.slice(0, 8).map((r) => ({
      domain: r.domain,
      name: r.name,
      careers_url: r.careers_url,
      ats_type: r.ats_type,
      ats_identifier: r.ats_identifier,
    }))
    console.table(preview)
    writeReport({
      ...report,
      preview,
    })
    return
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  const upsertSql = `
    INSERT INTO companies (
      name,
      domain,
      careers_url,
      logo_url,
      industry,
      size,
      ats_type,
      ats_identifier,
      is_active,
      sponsors_h1b,
      sponsorship_confidence,
      raw_ats_config,
      last_crawled_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      true, $9, $10, $11::jsonb, NULL
    )
    ON CONFLICT (domain) DO UPDATE SET
      name = EXCLUDED.name,
      careers_url = CASE
        WHEN companies.careers_url IS NULL
          OR btrim(companies.careers_url) = ''
          OR companies.careers_url ILIKE '%linkedin.com%'
        THEN EXCLUDED.careers_url
        ELSE companies.careers_url
      END,
      logo_url = COALESCE(companies.logo_url, EXCLUDED.logo_url),
      industry = COALESCE(companies.industry, EXCLUDED.industry),
      size = COALESCE(companies.size, EXCLUDED.size),
      ats_type = COALESCE(NULLIF(companies.ats_type, ''), EXCLUDED.ats_type),
      ats_identifier = COALESCE(companies.ats_identifier, EXCLUDED.ats_identifier),
      is_active = true,
      last_crawled_at = CASE
        WHEN COALESCE(companies.is_active, false) = false THEN NULL
        ELSE companies.last_crawled_at
      END,
      sponsors_h1b = COALESCE(companies.sponsors_h1b, EXCLUDED.sponsors_h1b),
      sponsorship_confidence = GREATEST(
        COALESCE(companies.sponsorship_confidence, 0),
        COALESCE(EXCLUDED.sponsorship_confidence, 0)
      ),
      raw_ats_config = COALESCE(companies.raw_ats_config, '{}'::jsonb) || EXCLUDED.raw_ats_config,
      updated_at = NOW()
    RETURNING id, name, domain, (xmax = 0) AS was_inserted
  `

  try {
    for (const row of rows) {
      const rawAtsConfig = JSON.stringify({
        source: "known_seed_topup",
        created_via: "seed_trending_tech_companies",
        created_at: nowIso,
        guessed_domain: row.domain,
        domain_verified: true,
        ats_discovery_status: "checked",
        known_seed_topup: {
          mode: "insert_or_update",
          synced_at: nowIso,
          seed_name: row.name,
          seed_domain: row.domain,
          seed_careers_url: row.careers_url,
        },
      })

      const { rows: upserted } = await pool.query<{
        id: string
        name: string
        domain: string
        was_inserted: boolean
      }>(upsertSql, [
        row.name,
        row.domain,
        row.careers_url,
        row.logo_url,
        row.industry,
        row.size,
        row.ats_type ?? "custom",
        row.ats_identifier,
        row.sponsors_h1b,
        row.sponsorship_confidence,
        rawAtsConfig,
      ])

      const result = upserted[0]
      if (!result) continue

      if (result.was_inserted) report.inserted += 1
      else report.updated += 1

      report.changed.push({
        id: result.id,
        name: result.name,
        domain: result.domain,
        action: result.was_inserted ? "insert" : "update",
      })
    }
  } finally {
    await pool.end()
  }

  console.log(`[trending-tech] inserted: ${report.inserted}`)
  console.log(`[trending-tech] updated : ${report.updated}`)
  writeReport(report)
}

main().catch((error) => {
  console.error("[trending-tech] failed", error)
  process.exit(1)
})

