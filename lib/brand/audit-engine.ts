import { getPostgresPool } from "@/lib/postgres/server"
import type { VisibilityScore } from "./visibility-scorer"

export type BrandAuditItem = {
  item_type: string
  severity: "high" | "medium" | "low"
  title: string
  detail: string
  fix_action: string
  material_icon: string
}

export async function runBrandAudit(
  userId: string,
  visibilityScore: VisibilityScore
): Promise<BrandAuditItem[]> {
  const pool = getPostgresPool()

  const brandResult = await pool.query<{
    linkedin_url: string | null
    has_about_section: boolean | null
    headline: string | null
    skills_count: number | null
    recommendations_count: number | null
    communities_active: number
    days_since_last_activity: number | null
    last_post_detected_at: string | null
  }>(
    `SELECT linkedin_url, has_about_section, headline, skills_count,
            recommendations_count, communities_active, days_since_last_activity,
            last_post_detected_at
     FROM public.user_brand_profiles WHERE user_id = $1`,
    [userId]
  )

  const brand = brandResult.rows[0]
  const items: BrandAuditItem[] = []
  const breakdown = visibilityScore.breakdown

  // No activity
  if (breakdown.activity.score === 0) {
    const daysSince = brand?.days_since_last_activity ?? 999
    items.push({
      item_type: "no_activity",
      severity: daysSince > 365 ? "high" : "medium",
      title: "No LinkedIn activity detected",
      detail: "Posting consistently (even 2–3 times/month) increases profile visibility by 3–5× and is one of the highest-ROI things you can do during a job search.",
      fix_action: "Post your first piece of content — use the Content Ideas tab to get started in under 5 minutes",
      material_icon: "campaign",
    })
  } else if (breakdown.activity.score <= 10) {
    items.push({
      item_type: "low_activity",
      severity: "medium",
      title: "Posting infrequently",
      detail: "You've posted in the last 6 months but not recently. Recruiters often check LinkedIn activity before reaching out.",
      fix_action: "Aim for 2 posts per month — use your saved ideas to stay consistent",
      material_icon: "schedule",
    })
  }

  // No LinkedIn URL
  if (!brand?.linkedin_url) {
    items.push({
      item_type: "no_linkedin_url",
      severity: "high",
      title: "LinkedIn URL not on file",
      detail: "Without your LinkedIn URL, we can't track your visibility or sync your profile data. Recruiters also expect it on your resume.",
      fix_action: "Add your LinkedIn URL in the Brand tab settings — takes 30 seconds",
      material_icon: "link",
    })
  }

  // Weak headline
  if (!brand?.headline || brand.headline.length < 40) {
    items.push({
      item_type: "weak_headline",
      severity: "high",
      title: "Headline is too short or missing",
      detail: "A headline like 'Software Engineer at Acme' misses the opportunity to stand out. Longer, keyword-rich headlines rank better in LinkedIn search.",
      fix_action: "Generate an optimized headline using the Content Ideas tab — we'll write it for you",
      material_icon: "title",
    })
  }

  // No About section
  if (brand?.has_about_section === false || brand?.has_about_section === null) {
    items.push({
      item_type: "no_about",
      severity: "high",
      title: "No About section detected",
      detail: "Profiles with an About section receive 21× more views than those without. It's your chance to tell your story beyond your job titles.",
      fix_action: "Generate an About section using your resume — we'll draft it from your experience",
      material_icon: "person",
    })
  }

  // Low recommendations
  const recs = brand?.recommendations_count ?? 0
  if (recs === 0) {
    items.push({
      item_type: "low_recommendations",
      severity: "medium",
      title: "No recommendations",
      detail: "Recommendations act as social proof — they show what it's actually like to work with you, in other people's words.",
      fix_action: "Request 2–3 recommendations from former managers or colleagues — use the template in Content Ideas",
      material_icon: "star",
    })
  } else if (recs < 3) {
    items.push({
      item_type: "few_recommendations",
      severity: "low",
      title: `Only ${recs} recommendation${recs !== 1 ? "s" : ""}`,
      detail: "Aim for 5+ recommendations. Each one adds credibility and helps your profile rank in recruiter searches.",
      fix_action: "Request one more recommendation — focus on people who can speak to your specific technical skills",
      material_icon: "star_half",
    })
  }

  // No communities
  if ((brand?.communities_active ?? 0) === 0) {
    items.push({
      item_type: "no_communities",
      severity: "low",
      title: "Not active in any communities",
      detail: "LinkedIn groups and newsletters help you reach people outside your immediate network and signal active participation in your field.",
      fix_action: "Join 2–3 relevant LinkedIn groups or subscribe to industry newsletters — this takes 5 minutes",
      material_icon: "groups",
    })
  }

  // Missing skills (based on resume but estimate for LinkedIn)
  const skillsCount = brand?.skills_count ?? 0
  if (skillsCount < 10 && skillsCount >= 0) {
    items.push({
      item_type: "missing_skills",
      severity: "low",
      title: "Skills section may be incomplete",
      detail: "LinkedIn's algorithm prioritizes profiles with 10+ skills. More skills = more recruiter search visibility.",
      fix_action: "Add your top skills from your resume to your LinkedIn Skills section",
      material_icon: "psychology",
    })
  }

  // Persist to DB (clear old, insert fresh)
  await pool.query(
    `DELETE FROM public.brand_audit_items WHERE user_id = $1 AND resolved = false`,
    [userId]
  )

  for (const item of items) {
    await pool.query(
      `INSERT INTO public.brand_audit_items
         (user_id, item_type, severity, title, detail, fix_action, material_icon)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, item.item_type, item.severity, item.title, item.detail, item.fix_action, item.material_icon]
    )
  }

  return items
}

export async function generateWeeklyActions(
  userId: string,
  visibilityScore: VisibilityScore,
  auditItems: BrandAuditItem[]
): Promise<Array<{ action: string; type: string; estimatedMinutes: number }>> {
  const actions: Array<{ action: string; type: string; estimatedMinutes: number }> = []

  // Pull pending content ideas
  const pool = getPostgresPool()
  const ideasResult = await pool.query<{ title: string; content_type: string }>(
    `SELECT title, content_type FROM public.brand_content_ideas
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 3`,
    [userId]
  )

  const highSeverityItems = auditItems.filter((i) => i.severity === "high").slice(0, 2)

  for (const item of highSeverityItems) {
    actions.push({ action: item.fix_action, type: "fix", estimatedMinutes: 10 })
  }

  for (const idea of ideasResult.rows.slice(0, 2)) {
    actions.push({
      action: `Write and post: "${idea.title}"`,
      type: "post",
      estimatedMinutes: idea.content_type === "linkedin_article" ? 30 : 15,
    })
  }

  if (actions.length < 3) {
    actions.push({
      action: "Review your top 3 content ideas and pick one to write this week",
      type: "plan",
      estimatedMinutes: 10,
    })
  }

  const weekOf = new Date().toISOString().split("T")[0]
  await pool.query(
    `INSERT INTO public.brand_weekly_actions (user_id, week_of, actions)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, week_of) DO UPDATE SET actions = EXCLUDED.actions`,
    [userId, weekOf, JSON.stringify(actions)]
  )

  return actions
}
