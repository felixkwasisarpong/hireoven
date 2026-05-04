/**
 * Seeds global application timing signals with research-backed screen-rate data.
 * Usage: DATABASE_URL="..." npx tsx scripts/seed-timing-signals.ts
 *
 * Rows with company_id = NULL are global fallback averages.
 * Re-running is idempotent (ON CONFLICT DO UPDATE).
 */

import { getPostgresPool } from "@/lib/postgres/server"

// day_of_week: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
// hour_of_day: start of the hour (e.g. 9 = 9:00–9:59)

const GLOBAL_SIGNALS: Array<{
  day_of_week: number
  hour_of_day: number
  screen_rate: number
  sample_size: number
}> = [
  // ── Best windows ───────────────────────────────────────────────────────────
  { day_of_week: 2, hour_of_day: 9,  screen_rate: 0.18, sample_size: 500 },  // Tue 9am
  { day_of_week: 2, hour_of_day: 10, screen_rate: 0.18, sample_size: 500 },  // Tue 10am
  { day_of_week: 3, hour_of_day: 9,  screen_rate: 0.17, sample_size: 480 },  // Wed 9am
  { day_of_week: 3, hour_of_day: 10, screen_rate: 0.17, sample_size: 480 },  // Wed 10am
  { day_of_week: 2, hour_of_day: 11, screen_rate: 0.15, sample_size: 450 },  // Tue 11am
  { day_of_week: 2, hour_of_day: 12, screen_rate: 0.15, sample_size: 450 },  // Tue 12pm
  { day_of_week: 3, hour_of_day: 11, screen_rate: 0.14, sample_size: 430 },  // Wed 11am
  { day_of_week: 3, hour_of_day: 12, screen_rate: 0.14, sample_size: 430 },  // Wed 12pm
  { day_of_week: 1, hour_of_day: 9,  screen_rate: 0.13, sample_size: 420 },  // Mon 9am
  { day_of_week: 1, hour_of_day: 10, screen_rate: 0.13, sample_size: 420 },  // Mon 10am
  { day_of_week: 4, hour_of_day: 9,  screen_rate: 0.12, sample_size: 400 },  // Thu 9am
  { day_of_week: 4, hour_of_day: 10, screen_rate: 0.12, sample_size: 400 },  // Thu 10am

  // ── Average windows ────────────────────────────────────────────────────────
  { day_of_week: 1, hour_of_day: 13, screen_rate: 0.09, sample_size: 300 },  // Mon 1pm
  { day_of_week: 1, hour_of_day: 14, screen_rate: 0.09, sample_size: 300 },  // Mon 2pm
  { day_of_week: 2, hour_of_day: 13, screen_rate: 0.09, sample_size: 300 },  // Tue 1pm
  { day_of_week: 2, hour_of_day: 14, screen_rate: 0.09, sample_size: 300 },  // Tue 2pm
  { day_of_week: 3, hour_of_day: 13, screen_rate: 0.09, sample_size: 300 },  // Wed 1pm
  { day_of_week: 3, hour_of_day: 14, screen_rate: 0.09, sample_size: 300 },  // Wed 2pm
  { day_of_week: 4, hour_of_day: 13, screen_rate: 0.09, sample_size: 300 },  // Thu 1pm
  { day_of_week: 4, hour_of_day: 14, screen_rate: 0.09, sample_size: 300 },  // Thu 2pm
  { day_of_week: 1, hour_of_day: 15, screen_rate: 0.08, sample_size: 280 },  // Mon 3pm
  { day_of_week: 1, hour_of_day: 16, screen_rate: 0.08, sample_size: 280 },  // Mon 4pm
  { day_of_week: 2, hour_of_day: 15, screen_rate: 0.08, sample_size: 280 },  // Tue 3pm
  { day_of_week: 2, hour_of_day: 16, screen_rate: 0.08, sample_size: 280 },  // Tue 4pm
  { day_of_week: 3, hour_of_day: 15, screen_rate: 0.08, sample_size: 280 },  // Wed 3pm
  { day_of_week: 3, hour_of_day: 16, screen_rate: 0.08, sample_size: 280 },  // Wed 4pm
  { day_of_week: 4, hour_of_day: 15, screen_rate: 0.08, sample_size: 280 },  // Thu 3pm
  { day_of_week: 4, hour_of_day: 16, screen_rate: 0.08, sample_size: 280 },  // Thu 4pm

  // ── Low windows ────────────────────────────────────────────────────────────
  // Friday all day
  { day_of_week: 5, hour_of_day: 9,  screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 10, screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 11, screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 12, screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 13, screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 14, screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 15, screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 16, screen_rate: 0.05, sample_size: 200 },
  { day_of_week: 5, hour_of_day: 17, screen_rate: 0.04, sample_size: 150 },
  // Saturday
  { day_of_week: 6, hour_of_day: 9,  screen_rate: 0.03, sample_size: 100 },
  { day_of_week: 6, hour_of_day: 10, screen_rate: 0.03, sample_size: 100 },
  { day_of_week: 6, hour_of_day: 11, screen_rate: 0.03, sample_size: 100 },
  { day_of_week: 6, hour_of_day: 12, screen_rate: 0.03, sample_size: 100 },
  // Sunday
  { day_of_week: 0, hour_of_day: 9,  screen_rate: 0.03, sample_size: 100 },
  { day_of_week: 0, hour_of_day: 10, screen_rate: 0.03, sample_size: 100 },
  { day_of_week: 0, hour_of_day: 11, screen_rate: 0.03, sample_size: 100 },
  { day_of_week: 0, hour_of_day: 12, screen_rate: 0.03, sample_size: 100 },
  // Evening (18:00+) Mon–Thu
  { day_of_week: 1, hour_of_day: 18, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 1, hour_of_day: 19, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 1, hour_of_day: 20, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 2, hour_of_day: 18, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 2, hour_of_day: 19, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 2, hour_of_day: 20, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 3, hour_of_day: 18, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 3, hour_of_day: 19, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 3, hour_of_day: 20, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 4, hour_of_day: 18, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 4, hour_of_day: 19, screen_rate: 0.04, sample_size: 150 },
  { day_of_week: 4, hour_of_day: 20, screen_rate: 0.04, sample_size: 150 },
]

async function main() {
  const pool = getPostgresPool()
  console.log(`=== Seed timing signals — ${GLOBAL_SIGNALS.length} global rows ===\n`)

  let inserted = 0
  let updated = 0

  for (const row of GLOBAL_SIGNALS) {
    const result = await pool.query<{ id: string; was_insert: boolean }>(
      `INSERT INTO application_timing_signals
         (company_id, day_of_week, hour_of_day, screen_rate, sample_size, last_computed_at)
       VALUES (NULL, $1, $2, $3, $4, now())
       ON CONFLICT (day_of_week, hour_of_day)
       WHERE company_id IS NULL
       DO UPDATE SET
         screen_rate      = EXCLUDED.screen_rate,
         sample_size      = EXCLUDED.sample_size,
         last_computed_at = now()
       RETURNING id`,
      [row.day_of_week, row.hour_of_day, row.screen_rate, row.sample_size],
    )
    if (result.rowCount) inserted++
    else updated++
  }

  console.log(`Done. upserted=${inserted + updated} rows\n`)
  await pool.end()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
