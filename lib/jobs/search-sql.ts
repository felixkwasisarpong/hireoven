export function tokenizeJobSearchQuery(query: string, maxTokens = 8): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[()[\]{}"'`,;:!?]+|[()[\]{}"'`,;:!?]+$/g, ""))
    .filter(Boolean)
    .slice(0, Math.max(1, maxTokens))
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export function buildJobSearchTokenSql({
  jobsAlias = "jobs",
  companiesAlias = "companies",
  patternParam,
  token,
}: {
  jobsAlias?: string
  companiesAlias?: string
  patternParam: string
  token: string
}): string {
  const remoteClause = token.trim().toLowerCase() === "remote"
    ? ` OR ${jobsAlias}.is_remote = true`
    : ""

  return `(
        ${jobsAlias}.title ILIKE ${patternParam} ESCAPE '\\'
        OR ${jobsAlias}.normalized_title ILIKE ${patternParam} ESCAPE '\\'
        OR ${jobsAlias}.location ILIKE ${patternParam} ESCAPE '\\'
        OR ${companiesAlias}.name ILIKE ${patternParam} ESCAPE '\\'
        OR ${companiesAlias}.domain ILIKE ${patternParam} ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM unnest(${jobsAlias}.skills) s
          WHERE s ILIKE ${patternParam} ESCAPE '\\'
        )
        ${remoteClause}
      )`
}
