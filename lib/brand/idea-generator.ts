import Anthropic from "@anthropic-ai/sdk"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { getPostgresPool } from "@/lib/postgres/server"

export type BrandContentIdea = {
  title: string
  hook: string
  content_type: "linkedin_post" | "linkedin_article" | "community_post" | "recommendation_request" | "profile_update"
  topic_tags: string[]
  estimated_reach_min: number | null
  estimated_reach_max: number | null
  best_day_to_post: string | null
  generated_from: string
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

type UserContext = {
  fullName: string | null
  topSkills: string[]
  seniorityLevel: string | null
  yearsExperience: number | null
  roleHistory: string[]
  targetRoles: string[]
  summary: string | null
  targetIndustries: string[]
  memories: string[]
}

async function gatherUserContext(userId: string): Promise<UserContext> {
  const pool = getPostgresPool()

  const [resumeResult, profileResult, appResult, memoryResult] = await Promise.all([
    pool.query<{
      full_name: string | null
      top_skills: string[] | null
      skills: unknown
      seniority_level: string | null
      years_of_experience: number | null
      summary: string | null
      work_experience: unknown
    }>(
      `SELECT full_name, top_skills, skills, seniority_level, years_of_experience, summary, work_experience
       FROM resumes WHERE user_id = $1 AND parse_status = 'complete'
       ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
      [userId]
    ),
    pool.query<{ desired_roles: string[] | null }>(
      `SELECT desired_roles FROM profiles WHERE id = $1`,
      [userId]
    ),
    pool.query<{ job_title: string; company_name: string }>(
      `SELECT job_title, company_name FROM job_applications
       WHERE user_id = $1 AND status NOT IN ('saved', 'withdrawn')
       ORDER BY created_at DESC LIMIT 20`,
      [userId]
    ),
    pool.query<{ summary: string; category: string }>(
      `SELECT summary, category FROM scout_memories
       WHERE user_id = $1 AND active = true
         AND category IN ('skill_focus', 'career_goal', 'role_preference')
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    ),
  ])

  const resume = resumeResult.rows[0]
  const profile = profileResult.rows[0]

  const resumeSkills = (() => {
    const s = resume?.skills
    if (!s || typeof s !== "object") return []
    const obj = s as { technical?: string[]; soft?: string[] }
    return [...(obj.technical ?? []), ...(obj.soft ?? [])].slice(0, 12)
  })()

  const workExp = (() => {
    const w = resume?.work_experience
    if (!Array.isArray(w)) return []
    return (w as Array<{ company?: string; title?: string }>)
      .slice(0, 5)
      .map((e) => [e.title, e.company].filter(Boolean).join(" at "))
  })()

  const topSkills = [...new Set([
    ...(resume?.top_skills ?? []),
    ...resumeSkills,
  ])].slice(0, 10)

  const targetRoles = [
    ...(profile?.desired_roles ?? []),
    ...appResult.rows.map((r) => r.job_title),
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 6)

  return {
    fullName: resume?.full_name ?? null,
    topSkills,
    seniorityLevel: resume?.seniority_level ?? null,
    yearsExperience: resume?.years_of_experience ?? null,
    roleHistory: workExp,
    targetRoles,
    summary: resume?.summary ?? null,
    targetIndustries: [...new Set(appResult.rows.map((r) => r.company_name))].slice(0, 5),
    memories: memoryResult.rows.map((m) => m.summary),
  }
}

const FALLBACK_IDEAS: BrandContentIdea[] = [
  {
    title: "The biggest lesson from my first year in the industry",
    hook: "One year in, I thought I knew what senior engineers did. I was wrong about almost everything.",
    content_type: "linkedin_post",
    topic_tags: ["career", "lessons", "growth"],
    estimated_reach_min: 500, estimated_reach_max: 2000,
    best_day_to_post: "Tuesday",
    generated_from: "career history",
  },
  {
    title: "How I improved my technical interview success rate",
    hook: "I used to freeze in system design rounds. Here's the 3-step framework that changed that.",
    content_type: "linkedin_post",
    topic_tags: ["interviews", "career", "technical"],
    estimated_reach_min: 800, estimated_reach_max: 3000,
    best_day_to_post: "Wednesday",
    generated_from: "interview experience",
  },
]

function buildCvPrompt(ctx: UserContext, count: number): string {
  return `You are a personal brand coach for tech professionals. Generate ${count} specific LinkedIn content ideas.

USER PROFILE:
- Name: ${ctx.fullName ?? "the user"}
- Seniority: ${ctx.seniorityLevel ?? "mid-level"} · ${ctx.yearsExperience ?? "several"} years experience
- Top skills: ${ctx.topSkills.join(", ") || "software engineering"}
- Role history: ${ctx.roleHistory.join(" → ") || "software engineering"}
- Targeting: ${ctx.targetRoles.slice(0, 3).join(", ") || "senior engineering roles"}
- Summary: ${ctx.summary ? ctx.summary.slice(0, 200) : "experienced software professional"}
- Career context: ${ctx.memories.join("; ") || "active job seeker"}

RULES — every idea MUST follow these:
1. Grounded in their ACTUAL experience and skills listed above — no generic advice
2. Specific enough that only this person could write it authentically
3. Topics with real engagement: lessons learned, specific frameworks they use, behind-the-scenes of their work, career pivots, tool comparisons
4. NO: "5 tips for success" or vague inspiration posts
5. Each idea must be completable in under 300 words for a linkedin_post

Return a JSON array of ${count} objects with this exact shape:
[{
  "title": "Specific post title (the real headline)",
  "hook": "The opening sentence or premise — the first line of the post, max 20 words, must make someone stop scrolling",
  "content_type": "linkedin_post",
  "topic_tags": ["tag1", "tag2", "tag3"],
  "estimated_reach_min": 500,
  "estimated_reach_max": 2500,
  "best_day_to_post": "Tuesday",
  "generated_from": "which specific skill, experience, or career moment inspired this"
}]

Mix content types: 3 linkedin_posts, 1 linkedin_article, 1 profile_update.
Order by estimated impact (highest first).`
}

function buildTrendingPrompt(ctx: UserContext, count: number): string {
  const field = ctx.topSkills.slice(0, 5).join(", ") || "software engineering"
  const seniority = ctx.seniorityLevel ?? "mid-level"
  const targeting = ctx.targetRoles.slice(0, 3).join(", ") || "engineering roles"

  return `You are a personal brand coach for tech professionals. Generate ${count} LinkedIn content ideas based on CURRENTLY TRENDING topics in their field — not their personal history.

PERSON'S BACKGROUND (use this so they can write authentically):
- Seniority: ${seniority} · ${ctx.yearsExperience ?? "several"} years experience
- Skills: ${field}
- Targeting: ${targeting}

YOUR TASK:
Identify hot, currently discussed topics/debates/tools/shifts in the space of: ${field}.
Examples of the type of thing you should surface:
- A newly released framework, model, or tool everyone is evaluating
- An industry debate or opinion (e.g. "is X dead?", "X vs Y")
- A hiring/job market shift that affects people in this field
- An AI tool that is changing workflows in this domain
- A recent methodology shift (e.g. new best practice replacing old one)
- A regulatory/legal development relevant to this industry

RULES:
1. Each idea must be about something ACTUALLY trending or debated right now in their field
2. Show them how to connect it to their own experience — the hook should feel like their authentic take
3. Hot takes and contrarian angles outperform neutral summaries
4. No generic "thoughts on AI" — be specific about which tool, which debate, which shift
5. Each idea must be completable in under 300 words for a linkedin_post

Return a JSON array of ${count} objects with this exact shape:
[{
  "title": "Specific headline anchored to the trend",
  "hook": "Their authentic opening take on this trend, max 20 words, first-person or strong opinion",
  "content_type": "linkedin_post",
  "topic_tags": ["tag1", "tag2", "tag3"],
  "estimated_reach_min": 1000,
  "estimated_reach_max": 5000,
  "best_day_to_post": "Tuesday",
  "generated_from": "name the specific trend, tool, or debate this is about"
}]

Mix: 3 linkedin_posts, 1 linkedin_article, 1 community_post.
Order by likely virality (highest first).`
}

export async function generateContentIdeas(
  userId: string,
  count = 5,
  mode: "cv" | "trending" = "cv"
): Promise<BrandContentIdea[]> {
  const ctx = await gatherUserContext(userId)

  if (!anthropic) return FALLBACK_IDEAS.slice(0, count)

  const prompt = mode === "trending"
    ? buildTrendingPrompt(ctx, count)
    : buildCvPrompt(ctx, count)

  try {
    const message = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    })

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")

    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return FALLBACK_IDEAS.slice(0, count)

    const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>

    const valid = parsed
      .filter((item) => typeof item.title === "string" && typeof item.hook === "string")
      .slice(0, count)
      .map((item): BrandContentIdea => ({
        title: String(item.title),
        hook: String(item.hook),
        content_type: ["linkedin_post", "linkedin_article", "community_post", "recommendation_request", "profile_update"]
          .includes(String(item.content_type))
          ? (item.content_type as BrandContentIdea["content_type"])
          : "linkedin_post",
        topic_tags: Array.isArray(item.topic_tags)
          ? (item.topic_tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 5)
          : [],
        estimated_reach_min: typeof item.estimated_reach_min === "number" ? item.estimated_reach_min : null,
        estimated_reach_max: typeof item.estimated_reach_max === "number" ? item.estimated_reach_max : null,
        best_day_to_post: typeof item.best_day_to_post === "string" ? item.best_day_to_post : null,
        generated_from: typeof item.generated_from === "string" ? item.generated_from : "resume",
      }))

    // Persist to DB
    const pool = getPostgresPool()
    for (const idea of valid) {
      await pool.query(
        `INSERT INTO public.brand_content_ideas
           (user_id, title, hook, content_type, topic_tags, estimated_reach_min,
            estimated_reach_max, best_day_to_post, generated_from)
         VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9)`,
        [userId, idea.title, idea.hook, idea.content_type, idea.topic_tags,
         idea.estimated_reach_min, idea.estimated_reach_max, idea.best_day_to_post, idea.generated_from]
      )
    }

    return valid.length > 0 ? valid : FALLBACK_IDEAS.slice(0, count)
  } catch {
    return FALLBACK_IDEAS.slice(0, count)
  }
}
