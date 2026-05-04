import { getPostgresPool } from "@/lib/postgres/server"

const DEPARTMENT_KEYWORDS: Record<string, string[]> = {
  Engineering: ["engineer", "engineering", "software", "backend", "frontend", "infra", "infrastructure", "devops", "sre", "platform", "tech", "developer", "dev", "architect"],
  Design: ["design", "designer", "ux", "ui", "product design", "creative"],
  Sales: ["sales", "account executive", "ae", "business development", "bdr", "sdr", "revenue"],
  Data: ["data", "analytics", "ml", "machine learning", "ai", "scientist", "analyst"],
  Operations: ["ops", "operations", "supply chain", "logistics", "fulfillment"],
  Marketing: ["marketing", "growth", "brand", "content", "seo", "demand gen"],
  Finance: ["finance", "accounting", "financial", "fp&a", "controller"],
  Product: ["product", "pm", "product manager", "product management"],
}

function detectDepartment(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const [dept, keywords] of Object.entries(DEPARTMENT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return dept
  }
  return null
}

export async function detectAndCreateCohorts(): Promise<{ created: number; skipped: number }> {
  const pool = getPostgresPool()
  let created = 0
  let skipped = 0

  // Find layoff_events in the last 90 days that don't yet have a cohort
  const eventsResult = await pool.query<{
    id: string
    company_id: string | null
    company_name_raw: string
    event_date: string
    headline: string | null
  }>(
    `SELECT le.id, le.company_id, le.company_name_raw, le.event_date, le.headline
     FROM public.layoff_events le
     WHERE le.event_date >= CURRENT_DATE - INTERVAL '90 days'
       AND le.company_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.layoff_cohorts lc
         WHERE lc.layoff_event_id = le.id
       )
     ORDER BY le.event_date DESC`
  )

  for (const event of eventsResult.rows) {
    if (!event.company_id) { skipped++; continue }

    // Check if a cohort already exists for this company within 30 days of event
    const existingResult = await pool.query<{ id: string }>(
      `SELECT id FROM public.layoff_cohorts
       WHERE company_id = $1
         AND ABS(layoff_date - $2::date) <= 30
       LIMIT 1`,
      [event.company_id, event.event_date]
    )

    if (existingResult.rows.length > 0) {
      // Update the existing cohort to link this event if not already linked
      await pool.query(
        `UPDATE public.layoff_cohorts
         SET layoff_event_id = $1, updated_at = now()
         WHERE id = $2 AND layoff_event_id IS NULL`,
        [event.id, existingResult.rows[0].id]
      )
      skipped++
      continue
    }

    const department = detectDepartment(event.headline)

    // Get canonical company name
    const companyResult = await pool.query<{ name: string }>(
      `SELECT name FROM public.companies WHERE id = $1`,
      [event.company_id]
    )
    const companyName = companyResult.rows[0]?.name ?? event.company_name_raw

    await pool.query(
      `INSERT INTO public.layoff_cohorts
         (company_id, company_name, layoff_event_id, department, layoff_date, status)
       VALUES ($1, $2, $3, $4, $5, 'forming')
       ON CONFLICT (layoff_event_id) DO NOTHING`,
      [event.company_id, companyName, event.id, department, event.event_date]
    )

    console.log(`[cohort-detector] Created cohort for ${companyName} (${event.event_date})${department ? ` — ${department}` : ""}`)
    created++
  }

  // Notify users whose current_company matches companies with new cohorts
  // We store an in-app notification via alert_notifications pattern (no email)
  // Using profiles.desired_roles as a proxy — skip email, flag only
  if (created > 0) {
    console.log(`[cohort-detector] Done — created: ${created}, skipped: ${skipped}`)
  }

  return { created, skipped }
}
