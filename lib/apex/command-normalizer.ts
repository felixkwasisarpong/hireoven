export function resolveExecutableApexCommand(message: string): string {
  const raw = message.trim()
  if (!raw) return raw

  if (/^(where should i focus today|what should i do next (?:today|this week)\??|build my attack plan|build today'?s attack plan|today'?s attack plan)$/i.test(raw)) {
    return "Run autonomous hunt for today"
  }

  if (/keep sponsor-friendly employers?.*immigration openness.*top of the queue/i.test(raw)) {
    return "Run autonomous hunt for sponsorship-friendly roles matching my profile"
  }

  if (/\btop[-\s]of[-\s](?:the[-\s])?queue\b/i.test(raw)) {
    return "Run autonomous hunt for today"
  }

  if (/shrink the active plan and finish deferred items before expanding the queue again/i.test(raw)) {
    return "Show my deferred plan items and tell me which one to finish first"
  }

  if (/lean into plan-driven batches right now/i.test(raw)) {
    return "Run autonomous hunt for today's highest-conviction batch"
  }

  if (/reduce breadth and operate in smaller, higher-conviction batches/i.test(raw)) {
    return "Run autonomous hunt for a narrower, higher-conviction queue"
  }

  if (/favor recent high-match postings and skip marginal fits/i.test(raw)) {
    return "Run autonomous hunt for recent high-match roles and rank them by likelihood"
  }

  if (/narrow role criteria before the next application batch/i.test(raw)) {
    return "Help me narrow my role criteria and filter the job feed accordingly"
  }

  const roleBiasMatch = raw.match(/^bias the next batch toward (.+?) because/i)
  if (roleBiasMatch?.[1]) {
    const lane = roleBiasMatch[1]
      .replace(/\s+fit$/i, "")
      .replace(/\s+lane$/i, "")
      .trim()

    if (lane) {
      return `Show ${lane} roles matching my profile and rank them by fit`
    }
  }

  return raw
}
