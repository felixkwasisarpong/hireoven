/**
 * Shadow Network Mode
 *
 * Finds warm referral paths at the user's target companies.
 * Works via the Chrome extension extracting the user's LinkedIn connection graph,
 * then scoring each connection by referral likelihood.
 *
 * Scoring factors:
 *   - Role relevance: are they in engineering / hiring mgmt / relevant team?
 *   - Degree: 1st > 2nd >> 3rd
 *   - Activity: recently posted on LinkedIn (more likely to respond)
 *   - Mutual connections: shared network = trust
 *   - Tenure: employees with 1-3yr tenure are most likely to refer (still excited, not jaded)
 */

export type ConnectionDegree = 1 | 2 | 3

export type ShadowConnection = {
  id: string
  name: string
  title: string
  company: string
  companyId?: string
  degree: ConnectionDegree
  /** Whether they posted on LinkedIn in the last 30 days */
  recentlyActive: boolean
  /** Mutual connection count */
  mutualCount: number
  /** Estimated tenure in months (0 = unknown) */
  tenureMonths: number
  /** Their LinkedIn profile URL */
  profileUrl?: string
}

export type ScoredConnection = ShadowConnection & {
  referralScore: number      // 0–100
  referralTier: "hot" | "warm" | "cold"
  scoreBreakdown: {
    degree: number          // 0–35
    roleRelevance: number   // 0–30
    activity: number        // 0–20
    tenure: number          // 0–15
  }
  dmDraft?: string
}

const ROLE_RELEVANCE_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\b(engineering manager|em|vp.{0,10}eng|director.{0,10}eng|head of eng)\b/i, score: 30 },
  { pattern: /\b(recruiter|talent|sourcer|hiring|people ops)\b/i, score: 28 },
  { pattern: /\b(staff|principal|senior|lead).{0,20}engineer\b/i, score: 22 },
  { pattern: /\b(software|platform|backend|frontend|fullstack|ml|data).{0,10}engineer\b/i, score: 18 },
  { pattern: /\b(product manager|pm|product lead)\b/i, score: 15 },
  { pattern: /\b(designer|ux|design lead)\b/i, score: 12 },
  { pattern: /\b(cto|ceo|co.?founder|founder)\b/i, score: 25 },
]

function scoreRoleRelevance(title: string): number {
  for (const { pattern, score } of ROLE_RELEVANCE_PATTERNS) {
    if (pattern.test(title)) return score
  }
  return 8
}

function scoreDegree(degree: ConnectionDegree): number {
  return degree === 1 ? 35 : degree === 2 ? 22 : 8
}

function scoreTenure(tenureMonths: number): number {
  if (tenureMonths === 0) return 7     // unknown
  if (tenureMonths >= 12 && tenureMonths <= 36) return 15
  if (tenureMonths >= 6  && tenureMonths <= 48) return 11
  if (tenureMonths > 48) return 8      // may be jaded
  return 5                              // very new
}

export function scoreConnection(c: ShadowConnection): ScoredConnection {
  const degree       = scoreDegree(c.degree)
  const roleRelevance = scoreRoleRelevance(c.title)
  const activity     = c.recentlyActive ? 20 : c.mutualCount > 3 ? 12 : 6
  const tenure       = scoreTenure(c.tenureMonths)

  const referralScore = degree + roleRelevance + activity + tenure
  const referralTier: ScoredConnection["referralTier"] =
    referralScore >= 70 ? "hot" :
    referralScore >= 45 ? "warm" :
    "cold"

  return {
    ...c,
    referralScore,
    referralTier,
    scoreBreakdown: { degree, roleRelevance, activity, tenure },
  }
}

export function rankConnections(connections: ShadowConnection[]): ScoredConnection[] {
  return connections
    .map(scoreConnection)
    .sort((a, b) => b.referralScore - a.referralScore)
}
