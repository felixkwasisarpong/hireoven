import { getPostgresPool } from "@/lib/postgres/server"
import { pickCodingProblemForSession, type CodingProblem } from "./queries"

const JD_TAG_PATTERNS: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /\bgraph[s]?\b|\bBFS\b|\bDFS\b|\btree[s]?\b/i, tags: ["bfs_dfs"] },
  { pattern: /\bdynamic programming\b|\b\bDP\b/i, tags: ["dp"] },
  { pattern: /\bstring[s]?\b|\bpars[ei]/i, tags: ["strings"] },
  { pattern: /\barray[s]?\b|\bsliding window\b/i, tags: ["arrays", "sliding_window"] },
  { pattern: /\bhash\b|\bmap\b|\bdict/i, tags: ["hashmap"] },
  { pattern: /\bstack\b|\bqueue\b/i, tags: ["stack_queue"] },
  { pattern: /\blinked list\b/i, tags: ["linked_list"] },
  { pattern: /\brecurs/i, tags: ["recursion"] },
  { pattern: /\btwo pointer[s]?\b/i, tags: ["two_pointers"] },
]

function difficultyFromDuration(durationMin: number): "easy" | "medium" | "hard" {
  if (durationMin <= 15) return "easy"
  if (durationMin <= 30) return "medium"
  return "hard"
}

function tagsFromJd(description: string): string[] {
  const found = new Set<string>()
  for (const { pattern, tags } of JD_TAG_PATTERNS) {
    if (pattern.test(description)) tags.forEach((t) => found.add(t))
  }
  return [...found]
}

export async function selectProblemForSession(input: {
  userId: string
  jobId?: string | null
  duration: number
}): Promise<CodingProblem> {
  const pool = getPostgresPool()
  const difficulty = difficultyFromDuration(input.duration)

  // Find previously attempted problem IDs to avoid repeats
  const attemptedResult = await pool.query<{ problem_id: string }>(
    `SELECT DISTINCT ca.problem_id
     FROM coding_attempts ca
     JOIN interview_sessions s ON s.id = ca.session_id
     WHERE s.user_id = $1`,
    [input.userId]
  )
  const excludeIds = attemptedResult.rows.map((r) => r.problem_id)

  // Derive preferred tags from JD
  let preferredTags: string[] = []
  if (input.jobId) {
    const jobResult = await pool.query<{ description: string | null }>(
      `SELECT description FROM jobs WHERE id = $1`,
      [input.jobId]
    )
    const jd = jobResult.rows[0]?.description ?? ""
    if (jd) preferredTags = tagsFromJd(jd)
  }

  const problem = await pickCodingProblemForSession({ difficulty, excludeIds, preferredTags })

  if (!problem) {
    // All problems in this difficulty were attempted — allow repeats
    const fallback = await pickCodingProblemForSession({ difficulty })
    if (!fallback) throw new Error(`No coding problems found for difficulty: ${difficulty}`)
    return fallback
  }

  return problem
}
