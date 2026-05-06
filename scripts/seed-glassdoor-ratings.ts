/**
 * Bulk-seed Glassdoor ratings via a real Chromium browser (Playwright).
 * Bypasses all bot detection — runs as a genuine browser session.
 *
 * Usage:
 *   npx tsx scripts/seed-glassdoor-ratings.ts
 *
 * Options (env vars):
 *   HEADLESS=false   Show the browser window (default: headless)
 *   BATCH=5          Parallel tab count (default: 3)
 *   START=0          Skip the first N companies (resume after a crash)
 *
 * Safe to re-run — already-rated companies are skipped.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pg from "pg"
import { chromium } from "playwright"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Minimal .env.local parser
const envPath = path.join(__dirname, "../.env.local")
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const HEADLESS = process.env.HEADLESS === "true" // default: visible browser (bypasses Cloudflare)
const BATCH    = Math.min(4, parseInt(process.env.BATCH ?? "1", 10))
const START    = parseInt(process.env.START ?? "0", 10)

// ── DB helpers ────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

function glassdoorScore(r: number) {
  if (r >= 4.5) return 25
  if (r >= 4.0) return 20
  if (r >= 3.5) return 14
  if (r >= 3.0) return 8
  return 2
}

async function saveRating(companyId: string, rating: number) {
  const gScore = glassdoorScore(rating)
  await pool.query(`
    INSERT INTO company_health_scores
      (company_id, total_score, verdict, funding_score, layoff_score,
       glassdoor_score, headcount_score, glassdoor_rating, last_computed_at, updated_at)
    VALUES ($1,
      LEAST(100, 10 + 25 + $2 + 12),
      CASE
        WHEN LEAST(100, 10 + 25 + $2 + 12) >= 75 THEN 'strong'
        WHEN LEAST(100, 10 + 25 + $2 + 12) >= 55 THEN 'healthy'
        WHEN LEAST(100, 10 + 25 + $2 + 12) >= 35 THEN 'caution'
        ELSE 'critical' END,
      10, 25, $2, 12, $3, NOW(), NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      glassdoor_rating = $3,
      glassdoor_score  = $2,
      total_score = LEAST(100, GREATEST(0,
        company_health_scores.funding_score + company_health_scores.layoff_score +
        $2 + company_health_scores.headcount_score)),
      verdict = CASE
        WHEN LEAST(100, GREATEST(0,
          company_health_scores.funding_score + company_health_scores.layoff_score +
          $2 + company_health_scores.headcount_score)) >= 75 THEN 'strong'
        WHEN LEAST(100, GREATEST(0,
          company_health_scores.funding_score + company_health_scores.layoff_score +
          $2 + company_health_scores.headcount_score)) >= 55 THEN 'healthy'
        WHEN LEAST(100, GREATEST(0,
          company_health_scores.funding_score + company_health_scores.layoff_score +
          $2 + company_health_scores.headcount_score)) >= 35 THEN 'caution'
        ELSE 'critical' END,
      updated_at = NOW()
  `, [companyId, gScore, rating])
}

// ── Glassdoor scraper (one tab) ───────────────────────────────────────────────

async function scrapeGlassdoor(
  page: import("playwright").Page,
  companyName: string
): Promise<{ rating: number; reviewCount: number | null } | null> {
  try {
    const q = encodeURIComponent(companyName)
    await page.goto(`https://www.glassdoor.com/Search/results.htm?keyword=${q}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    })

    const title = await page.title()
    if (/security|captcha|robot|access denied/i.test(title)) return null

    // Wait for the React app to render search results (★ appears in the text)
    try {
      await page.waitForFunction(() => document.body.innerText.includes("★"), { timeout: 12_000 })
    } catch {
      return null // page never rendered ratings
    }

    const text: string = await page.evaluate(() => document.body.innerText)

    // Find the first company entry whose name roughly matches ours.
    // Search results render as: "Company Name\n4.2★\n1.2Kjobs\n..."
    // Strategy: find "X.X★" or "X.X ★" entries in the Companies section.
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean)

    // Build a normalised name for fuzzy match
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]/g, "")
    const targetNorm = normalize(companyName)

    let rating: number | null = null
    let reviewCount: number | null = null

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]
      const next = lines[i + 1]

      // Rating line looks like "4.2★" or "4.2 ★"
      const ratingMatch = next?.match(/^([1-5]\.[0-9])\s*★/)
      if (!ratingMatch) continue

      // Check if this company line is a close enough match
      const lineNorm = normalize(line)
      const isMatch =
        lineNorm === targetNorm ||
        lineNorm.includes(targetNorm) ||
        targetNorm.includes(lineNorm) ||
        (targetNorm.length > 4 && lineNorm.slice(0, 8) === targetNorm.slice(0, 8))

      if (!isMatch) continue

      rating = Math.round(Number(ratingMatch[1]) * 10) / 10

      // Look for review count on the next few lines: "52.4Kreviews" → ~52400
      for (let j = i + 2; j < Math.min(i + 6, lines.length); j++) {
        const revMatch = lines[j]?.match(/^([\d.]+)(K|M)?\s*reviews?$/i)
        if (revMatch) {
          const n = Number(revMatch[1])
          const mult = revMatch[2]?.toUpperCase() === "M" ? 1_000_000 : revMatch[2]?.toUpperCase() === "K" ? 1_000 : 1
          reviewCount = Math.round(n * mult)
          break
        }
      }
      break
    }

    if (!rating) return null
    return { rating, reviewCount }
  } catch {
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { rows: companies } = await pool.query<{ id: string; name: string }>(`
    SELECT c.id, c.name
    FROM companies c
    LEFT JOIN company_health_scores chs ON chs.company_id = c.id
    WHERE c.is_active = true
      AND (chs.glassdoor_rating IS NULL OR chs.company_id IS NULL)
    ORDER BY c.job_count DESC NULLS LAST
  `)

  const todo = companies.slice(START)
  console.log(`\n${todo.length} companies to rate (${START} skipped)`)
  console.log(`Batch size: ${BATCH} parallel tabs\n`)

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  })

  // Create a persistent context so Glassdoor cookies accumulate naturally
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  })

  let found = 0
  let missed = 0
  const total = todo.length

  // Process in batches of BATCH parallel tabs
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)

    await Promise.all(batch.map(async ({ id, name }, batchIdx) => {
      const globalIdx = START + i + batchIdx + 1
      const page = await context.newPage()
      try {
        const result = await scrapeGlassdoor(page, name)
        if (result) {
          await saveRating(id, result.rating)
          console.log(`✓ [${globalIdx}/${total + START}] ${name} → ${result.rating}★${result.reviewCount ? ` (${result.reviewCount.toLocaleString()} reviews)` : ""}`)
          found++
        } else {
          console.log(`– [${globalIdx}/${total + START}] ${name} → not found`)
          missed++
        }
      } catch (e) {
        console.log(`✗ [${globalIdx}/${total + START}] ${name} → error: ${e instanceof Error ? e.message : String(e)}`)
        missed++
      } finally {
        await page.close()
      }
    }))

    // Random pause between batches to stay under the radar (1–3s)
    if (i + BATCH < todo.length) {
      await new Promise(r => setTimeout(r, 1_000 + Math.random() * 2_000))
    }
  }

  await context.close()
  await browser.close()
  await pool.end()

  console.log(`\n✓ Done — found: ${found}  missed: ${missed}  total: ${total}\n`)
  console.log(`Re-run with START=${START + found + missed} to resume from where you left off.`)
}

main().catch(err => { console.error(err); process.exit(1) })
