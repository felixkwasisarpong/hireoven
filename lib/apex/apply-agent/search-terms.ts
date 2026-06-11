// Strip bulk-apply framing and return only meaningful title/description terms.
// ATS names are filtered structurally through the `ats` query parameter, so they
// must not leak into free-text job matching.
export function extractApplyAgentSearchTerms(raw: string): string {
  return raw
    .replace(/\b(apply\s+(to|for)|queue|batch|bulk|prepare)\b/gi, "")
    .replace(/\b(top|best|strongest|highest|matching|matched|scored?)\b/gi, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\b(jobs?|roles?|positions?|openings?|applications?|applying)\b/gi, "")
    .replace(/\b(remote|onsite|hybrid)\b/gi, "")
    .replace(/\b(h-?1b|visa|sponsor(ship)?)\b/gi, "")
    .replace(/\b(ats|greenhouse|lever|workday|ashby(hq)?|icims|smart\s*recruiters?|bamboo(hr)?)\b/gi, "")
    .replace(/\b(with|in|at|for|and|the|that|has|have|a|an|it|use|uses|using)\b/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
