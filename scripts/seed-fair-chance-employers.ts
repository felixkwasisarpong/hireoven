/**
 * Seed known fair chance employers with verified pledge sources.
 *
 * Usage:
 *   npx tsx scripts/seed-fair-chance-employers.ts
 *   npx tsx scripts/seed-fair-chance-employers.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")

type FairChanceRow = {
  company_name: string
  pledge_type: "fair_chance_pledge" | "ban_the_box" | "second_chance"
  pledge_source_url: string | null
  verified: boolean
}

const EMPLOYERS: FairChanceRow[] = [
  {
    company_name: "Amazon",
    pledge_type: "second_chance",
    pledge_source_url: "https://www.aboutamazon.com/news/workplace/amazon-second-chance",
    verified: true,
  },
  {
    company_name: "Target",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://corporate.target.com/press/releases/2019/09/target-expands-fair-chance-hiring-practices",
    verified: true,
  },
  {
    company_name: "Walmart",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://corporate.walmart.com/news/2020/09/28/walmart-expands-fair-and-second-chance-hiring-commitment",
    verified: true,
  },
  {
    company_name: "JPMorgan Chase",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://www.jpmorganchase.com/impact/people/fair-chance-hiring",
    verified: true,
  },
  {
    company_name: "Microsoft",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://blogs.microsoft.com/on-the-issues/2018/08/09/fair-chance-hiring/",
    verified: true,
  },
  {
    company_name: "Starbucks",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://stories.starbucks.com/stories/2015/hiring-felons/",
    verified: true,
  },
  {
    company_name: "Domino's",
    pledge_type: "second_chance",
    pledge_source_url: "https://biz.dominos.com/web/public/careers",
    verified: true,
  },
  {
    company_name: "Dave & Buster's",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://www.daveandbusters.com/us/en/careers",
    verified: true,
  },
  {
    company_name: "Checkr",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://checkr.com/blog/fair-chance-hiring-pledge",
    verified: true,
  },
  {
    company_name: "Televerde",
    pledge_type: "second_chance",
    pledge_source_url: "https://televerde.com/social-impact/",
    verified: true,
  },
  {
    company_name: "Dave's Hot Chicken",
    pledge_type: "second_chance",
    pledge_source_url: "https://www.daveshotchicken.com/careers",
    verified: true,
  },
  {
    company_name: "Greyston Bakery",
    pledge_type: "ban_the_box",
    pledge_source_url: "https://www.greyston.org/open-hiring/",
    verified: true,
  },
  {
    company_name: "Homeboy Industries",
    pledge_type: "second_chance",
    pledge_source_url: "https://www.homeboyindustries.org/our-work/homeboy-industries/",
    verified: true,
  },
  {
    company_name: "The Source",
    pledge_type: "second_chance",
    pledge_source_url: "https://thesourceoc.org/workforce/",
    verified: true,
  },
  {
    company_name: "Nehemiah Manufacturing",
    pledge_type: "second_chance",
    pledge_source_url: "https://nehemiahmfg.com/jobs/",
    verified: true,
  },
  {
    company_name: "Dave's Killer Bread",
    pledge_type: "second_chance",
    pledge_source_url: "https://www.daveskillerbread.com/second-chance-employment",
    verified: true,
  },
  {
    company_name: "Honest Jobs",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://www.honestjobs.com/",
    verified: true,
  },
  {
    company_name: "Reentry Works",
    pledge_type: "second_chance",
    pledge_source_url: "https://reentryworks.org/",
    verified: true,
  },
  {
    company_name: "Koch Industries",
    pledge_type: "ban_the_box",
    pledge_source_url: "https://kochind.com/topics/criminal-justice/ban-the-box",
    verified: true,
  },
  {
    company_name: "McDonald's",
    pledge_type: "fair_chance_pledge",
    pledge_source_url: "https://corporate.mcdonalds.com/corpmcd/en-us/our-stories/article/our_stories.people.fair_chance.html",
    verified: true,
  },
]

async function run() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("DATABASE_URL is required")

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  console.log(`Seeding ${EMPLOYERS.length} fair chance employers...`)

  if (dryRun) {
    console.log("Dry run — would insert:", EMPLOYERS.map((e) => e.company_name).join(", "))
    await pool.end()
    return
  }

  for (const emp of EMPLOYERS) {
    // Try to match to an existing company by name (case-insensitive)
    const companyResult = await pool.query<{ id: string }>(
      `SELECT id FROM public.companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [emp.company_name]
    )
    const companyId = companyResult.rows[0]?.id ?? null

    await pool.query(
      `INSERT INTO public.fair_chance_employers (
        company_id, company_name, pledge_type, pledge_source_url, verified, verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING`,
      [
        companyId,
        emp.company_name,
        emp.pledge_type,
        emp.pledge_source_url,
        emp.verified,
        emp.verified ? new Date().toISOString().split("T")[0] : null,
      ]
    )

    const matchInfo = companyId ? ` (matched company_id: ${companyId})` : " (no company match)"
    console.log(`  ✓ ${emp.company_name}${matchInfo}`)
  }

  console.log(`\nSeeded ${EMPLOYERS.length} fair chance employers successfully.`)
  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
