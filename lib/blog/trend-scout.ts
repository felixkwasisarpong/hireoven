/**
 * Trend scout for blog generation.
 *
 * The blog used to pin one category to each weekday — Monday was always H-1B,
 * Tuesday always Job Market Pulse. Generation then had to find "the trending
 * story" inside that category whether or not anything had actually happened, so
 * quiet weeks produced recycled posts on ground the blog had already covered.
 *
 * This module inverts that: search across every category first, judge what is
 * genuinely newsworthy today, and let the winning story decide which category
 * the post belongs to. If nothing clears the bar, it says so and the run skips
 * rather than manufacturing a post. The selector also keeps category mix in
 * check so a hot immigration-policy week does not permanently collapse the blog
 * back into an H-1B-only publication.
 */
import Anthropic from "@anthropic-ai/sdk"
import { ANTHROPIC_MODEL_ROUTING } from "@/lib/ai/anthropic-models"
import type { BlogCategory } from "@/types/blog"

export type RecentPostDigest = {
  title: string
  excerpt: string | null
  categorySlug: string
  createdAt: string
}

export type TrendCandidate = {
  /** Category slug the story belongs to. Must match a known category. */
  categorySlug: string
  /** One-line description of the development. */
  headline: string
  /** Why this is newsworthy *today* rather than generally true. */
  whyNow: string
  /** 0-100. How much genuinely new information this carries. */
  noveltyScore: number
  /** Sources the scout relied on. */
  sources: string[]
}

export type TrendScoutResult =
  | { status: "found"; candidate: TrendCandidate; considered: TrendCandidate[] }
  | { status: "nothing_trending"; reason: string; considered: TrendCandidate[] }

/**
 * Minimum novelty for a story to be worth a post. Below this the scout is
 * recycling: restating a standing fact ("H-1B is competitive") rather than
 * reporting a development. Tuned deliberately high — publishing nothing is a
 * better outcome than publishing the same post again.
 */
export const MIN_NOVELTY = 55
export const CATEGORY_BALANCE_WINDOW = 10
export const CATEGORY_DOMINANCE_THRESHOLD = 0.45
export const CATEGORY_BALANCE_MAX_NOVELTY_GAP = 20

const SCOUT_SYSTEM_PROMPT = `You are a news scout for Hireoven, a real-time job monitoring platform. Its readers are engineers, PMs, designers, operators, and data scientists actively job-hunting. Some are international candidates navigating H-1B, OPT, STEM OPT, and green-card timing, but the blog must not become immigration-only.

Your job is to find what is ACTUALLY developing right now across the categories you are given, and to be honest when nothing is.

Rules:
- Search the web. Prefer developments from the last 7 days.
- Scout all lanes: hiring demand, layoffs, remote/onsite shifts, compensation, company-specific hiring/freezes, recruiting process changes, interview formats, offer negotiation, resume/ATS changes, and immigration policy.
- A candidate must be a DEVELOPMENT — a rule change, a filing deadline, a layoff, an earnings/hiring signal, a policy ruling, a court decision, newly published labor data, a tooling/platform change, or a measurable hiring shift. Not an evergreen explainer.
- "H-1B is competitive" or "tailor your resume" are NOT developments. Score them low.
- Do NOT propose anything that substantially overlaps the recent posts you are shown. Covering the same ground again is the failure mode you exist to prevent.
- Do not over-file into H1B & Visa Intel. Include at most one immigration/visa candidate unless every genuinely newsworthy development today is immigration-specific.
- If recent posts are concentrated in one category, actively look for strong candidates in the other categories before returning your final list.
- noveltyScore is how much genuinely NEW information the story carries for this audience: 80+ a real development most readers have not seen, 55-79 a real but smaller update, below 55 essentially evergreen.
- It is correct and expected to return an empty candidate list on a quiet day.

CRITICAL: your ENTIRE response must be a single raw JSON object — no prose, no markdown fences. Start with { and end with }.

{
  "candidates": [
    {
      "categorySlug": "<one of the provided slugs>",
      "headline": "<one line: what happened>",
      "whyNow": "<why this is news today, not a standing fact>",
      "noveltyScore": <0-100>,
      "sources": ["<url or publication>"]
    }
  ]
}`

function recentCategoryCounts(recent: RecentPostDigest[], limit = CATEGORY_BALANCE_WINDOW): Map<string, number> {
  const counts = new Map<string, number>()
  for (const post of recent.slice(0, limit)) {
    counts.set(post.categorySlug, (counts.get(post.categorySlug) ?? 0) + 1)
  }
  return counts
}

function buildRecentCategoryMix(recent: RecentPostDigest[]): string {
  const counts = recentCategoryCounts(recent)
  if (counts.size === 0) return "(none yet)"

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => `- ${slug}: ${count} of the last ${Math.min(recent.length, CATEGORY_BALANCE_WINDOW)} posts`)
    .join("\n")
}

function buildScoutPrompt(categories: BlogCategory[], recent: RecentPostDigest[], today: string): string {
  const counts = recentCategoryCounts(recent)
  const categoryLines = [...categories]
    .sort((a, b) => {
      const byRecentCount = (counts.get(a.slug) ?? 0) - (counts.get(b.slug) ?? 0)
      if (byRecentCount !== 0) return byRecentCount
      return a.day_of_week - b.day_of_week
    })
    .map((c) => `- ${c.slug}: ${c.name} — ${c.description ?? ""}`)
    .join("\n")

  const recentLines = recent.length
    ? recent
        .map((p) => `- [${p.categorySlug}] ${p.title}${p.excerpt ? ` — ${p.excerpt.slice(0, 140)}` : ""}`)
        .join("\n")
    : "(none yet)"

  return `Today is ${today}.

Categories you may file a story under:
${categoryLines}

Hireoven has ALREADY published these posts. Do not propose anything that covers the same ground:
${recentLines}

Recent category mix:
${buildRecentCategoryMix(recent)}

Non-immigration search directions to try before settling on a visa story:
- tech hiring shifts, job postings, layoffs, headcount plans, earnings-call hiring signals
- remote/on-site policy changes and compensation bands affecting job seekers
- interview format changes, AI coding assessment policies, recruiter process changes
- offer negotiation, salary transparency, pay compression, and hiring timeline data
- ATS/recruiting platform changes that affect applications or candidate screening

Find up to 6 genuine developments from the last 7 days across ANY of those categories. Return a diverse list when real developments exist: aim for at least 3 non-immigration candidates and no more than 1 H1B/Visa candidate. Rank them by how newsworthy they are for this audience. If nothing genuinely new has happened, return {"candidates": []}.`
}

function parseScoutJson(raw: string): TrendCandidate[] {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end <= start) throw new Error("Trend scout returned no JSON object")
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { candidates?: unknown }
  if (!Array.isArray(parsed.candidates)) return []

  return parsed.candidates.flatMap((entry): TrendCandidate[] => {
    if (typeof entry !== "object" || entry === null) return []
    const c = entry as Record<string, unknown>
    const categorySlug = typeof c.categorySlug === "string" ? c.categorySlug.trim() : ""
    const headline = typeof c.headline === "string" ? c.headline.trim() : ""
    if (!categorySlug || !headline) return []
    const score = Number(c.noveltyScore)
    return [{
      categorySlug,
      headline,
      whyNow: typeof c.whyNow === "string" ? c.whyNow.trim() : "",
      noveltyScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
      sources: Array.isArray(c.sources) ? c.sources.filter((s): s is string => typeof s === "string") : [],
    }]
  })
}

/**
 * Reject candidates whose headline substantially restates a recent post.
 *
 * The model is told not to repeat itself, but a deterministic guard means a
 * drifting prompt cannot silently reintroduce the original problem. Compares
 * significant-word overlap against recent titles.
 */
export function isDuplicateOfRecent(
  candidate: TrendCandidate,
  recent: RecentPostDigest[],
  threshold = 0.6,
): boolean {
  const significant = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    )

  const words = significant(candidate.headline)
  if (words.size === 0) return false

  return recent.some((post) => {
    const postWords = significant(post.title)
    if (postWords.size === 0) return false
    let shared = 0
    for (const w of words) if (postWords.has(w)) shared += 1
    return shared / words.size >= threshold
  })
}

function dominantRecentCategories(recent: RecentPostDigest[]): Set<string> {
  const windowSize = Math.min(recent.length, CATEGORY_BALANCE_WINDOW)
  if (windowSize === 0) return new Set()

  const counts = recentCategoryCounts(recent, windowSize)
  const out = new Set<string>()
  for (const [slug, count] of counts) {
    if (count / windowSize >= CATEGORY_DOMINANCE_THRESHOLD) out.add(slug)
  }
  return out
}

/**
 * Pick the best candidate: known category, novel enough, not already covered.
 * Pure — separated from the API call so selection is testable without a model.
 */
export function selectTrend(
  candidates: TrendCandidate[],
  categories: BlogCategory[],
  recent: RecentPostDigest[],
): TrendScoutResult {
  const knownSlugs = new Set(categories.map((c) => c.slug))
  const considered = [...candidates].sort((a, b) => b.noveltyScore - a.noveltyScore)

  if (considered.length === 0) {
    return { status: "nothing_trending", reason: "Scout found no developments.", considered }
  }

  const eligible = considered.filter(
    (c) =>
      knownSlugs.has(c.categorySlug) &&
      c.noveltyScore >= MIN_NOVELTY &&
      !isDuplicateOfRecent(c, recent),
  )

  if (eligible.length === 0) {
    const best = considered[0]!
    const reason = !knownSlugs.has(best.categorySlug)
      ? `Top candidate filed under unknown category "${best.categorySlug}".`
      : best.noveltyScore < MIN_NOVELTY
        ? `Nothing cleared the novelty bar (best ${best.noveltyScore} < ${MIN_NOVELTY}).`
        : "Every candidate repeats a recent post."
    return { status: "nothing_trending", reason, considered }
  }

  const top = eligible[0]!
  const dominant = dominantRecentCategories(recent)
  if (dominant.has(top.categorySlug)) {
    const balanced = eligible.find(
      (candidate) =>
        !dominant.has(candidate.categorySlug) &&
        top.noveltyScore - candidate.noveltyScore <= CATEGORY_BALANCE_MAX_NOVELTY_GAP,
    )
    if (balanced) {
      return { status: "found", candidate: balanced, considered }
    }
  }

  return { status: "found", candidate: top, considered }
}

let anthropic: Anthropic | null = null
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured")
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropic
}

/** Search across every category and return the story worth writing, if any. */
export async function scoutTrendingTopic(input: {
  categories: BlogCategory[]
  recentPosts: RecentPostDigest[]
  today?: string
}): Promise<TrendScoutResult> {
  const today = input.today ?? new Date().toISOString().split("T")[0]!
  const client = getClient()

  const response = await client.beta.messages.create({
    model: ANTHROPIC_MODEL_ROUTING.BLOG_GENERATION,
    max_tokens: 3072,
    betas: ["web-search-2025-03-05"],
    tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 8 }],
    system: SCOUT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildScoutPrompt(input.categories, input.recentPosts, today) }],
  })

  const textBlock = [...response.content].reverse().find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Trend scout returned no text content")
  }

  return selectTrend(parseScoutJson(textBlock.text), input.categories, input.recentPosts)
}
