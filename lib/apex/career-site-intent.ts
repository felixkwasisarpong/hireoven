const CAREER_SITE_URL_HINT =
  /\b(careers?|jobs?|openings?|positions?|opportunities?|join-us|work-with-us|boards?|greenhouse|lever|ashby|ashbyhq|workdayjobs|myworkdayjobs|icims|smartrecruiters|bamboohr|jobvite|workable|successfactors|taleo|oraclecloud|recruitee|comeet|teamtailor|personio|pinpointhq|rippling|paylocity)\b/i

export function extractCareerSiteUrlFromMessage(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null

  const rawUrl = match[0].replace(/[),.;!?]+$/g, "")
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    if (parsed.hostname.includes("hireoven")) return null

    const urlSignal = `${parsed.hostname} ${parsed.pathname} ${parsed.search}`.replace(/[-_/?.=&%]+/g, " ")
    if (!CAREER_SITE_URL_HINT.test(urlSignal) && !CAREER_SITE_URL_HINT.test(message)) return null
    return parsed.toString()
  } catch {
    return null
  }
}
