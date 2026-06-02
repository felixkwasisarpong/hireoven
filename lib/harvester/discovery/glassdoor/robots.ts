export type RobotsDirective = "allow" | "disallow"

export type RobotsRule = {
  directive: RobotsDirective
  pattern: string
  lineNumber: number
}

export type RobotsGroup = {
  agents: string[]
  rules: RobotsRule[]
}

export type RobotsCheckResult = {
  allowed: boolean
  reason: string
  robotsUrl: string
  matchedRule?: RobotsRule
}

export type RobotsCacheOptions = {
  fetchImpl?: typeof fetch
  userAgent: string
  timeoutMs?: number
  ttlMs?: number
  beforeRequest?: () => Promise<void>
  onRequestAttempt?: (url: string) => void
}

type RobotsCacheEntry = {
  fetchedAt: number
  robotsUrl: string
  status: number | null
  text: string | null
}

function stripComment(line: string): string {
  const idx = line.indexOf("#")
  return (idx === -1 ? line : line.slice(0, idx)).trim()
}

export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let agents: string[] = []
  let rules: RobotsRule[] = []
  let sawRule = false

  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules })
    agents = []
    rules = []
    sawRule = false
  }

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripComment(lines[i] ?? "")
    if (!line) continue
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match) continue

    const key = match[1]!.toLowerCase()
    const value = match[2]!.trim()
    if (key === "user-agent") {
      if (agents.length > 0 && sawRule) flush()
      agents.push(value.toLowerCase())
      continue
    }

    if ((key === "allow" || key === "disallow") && agents.length > 0) {
      sawRule = true
      if (key === "disallow" && value === "") continue
      rules.push({ directive: key, pattern: value, lineNumber: i + 1 })
    }
  }

  flush()
  return groups
}

function agentMatches(ruleAgent: string, userAgent: string): boolean {
  if (ruleAgent === "*") return true
  return userAgent.toLowerCase().includes(ruleAgent.toLowerCase())
}

function selectedGroups(groups: RobotsGroup[], userAgent: string): RobotsGroup[] {
  const matching = groups.filter((group) =>
    group.agents.some((agent) => agentMatches(agent, userAgent))
  )
  const specific = matching.filter((group) => group.agents.some((agent) => agent !== "*"))
  if (specific.length > 0) {
    const longest = Math.max(
      ...specific.flatMap((group) =>
        group.agents.filter((agent) => agent !== "*").map((agent) => agent.length)
      )
    )
    return specific.filter((group) =>
      group.agents.some((agent) => agent !== "*" && agent.length === longest)
    )
  }
  return matching.filter((group) => group.agents.includes("*"))
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char
}

function patternToRegex(pattern: string): RegExp {
  let out = "^"
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!
    if (char === "*") out += ".*"
    else if (char === "$" && i === pattern.length - 1) out += "$"
    else out += escapeRegexChar(char)
  }
  return new RegExp(out)
}

function pathAndQuery(rawUrl: string): string {
  const parsed = new URL(rawUrl)
  return `${parsed.pathname}${parsed.search}`
}

export function checkRobotsAllowed(
  robotsText: string,
  targetUrl: string,
  userAgent: string
): Omit<RobotsCheckResult, "robotsUrl"> {
  const groups = selectedGroups(parseRobotsTxt(robotsText), userAgent)
  if (groups.length === 0) return { allowed: true, reason: "no_matching_group" }

  const path = pathAndQuery(targetUrl)
  let best: RobotsRule | null = null
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!rule.pattern) continue
      if (!patternToRegex(rule.pattern).test(path)) continue
      if (!best || rule.pattern.length > best.pattern.length) best = rule
      else if (
        best.pattern.length === rule.pattern.length &&
        rule.directive === "allow" &&
        best.directive === "disallow"
      ) {
        best = rule
      }
    }
  }

  if (!best) return { allowed: true, reason: "no_matching_rule" }
  return {
    allowed: best.directive === "allow",
    reason: `${best.directive}:${best.pattern}`,
    matchedRule: best,
  }
}

export class RobotsCache {
  private readonly fetchImpl: typeof fetch
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly ttlMs: number
  private readonly beforeRequest: (() => Promise<void>) | null
  private readonly onRequestAttempt: ((url: string) => void) | null
  private readonly cache = new Map<string, RobotsCacheEntry>()

  constructor(options: RobotsCacheOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.userAgent = options.userAgent
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000)
    this.ttlMs = Math.max(60_000, options.ttlMs ?? 6 * 60 * 60 * 1000)
    this.beforeRequest = options.beforeRequest ?? null
    this.onRequestAttempt = options.onRequestAttempt ?? null
  }

  async allowed(targetUrl: string): Promise<RobotsCheckResult> {
    const parsed = new URL(targetUrl)
    const robotsUrl = `${parsed.origin}/robots.txt`
    const entry = await this.fetchRobots(parsed.origin, robotsUrl)

    if (entry.status === 404) {
      return { allowed: true, reason: "robots_not_found", robotsUrl }
    }
    if (!entry.text || !entry.status || entry.status < 200 || entry.status >= 300) {
      return {
        allowed: false,
        reason: `robots_fetch_failed:${entry.status ?? "network"}`,
        robotsUrl,
      }
    }

    return {
      ...checkRobotsAllowed(entry.text, targetUrl, this.userAgent),
      robotsUrl,
    }
  }

  private async fetchRobots(origin: string, robotsUrl: string): Promise<RobotsCacheEntry> {
    const cached = this.cache.get(origin)
    if (cached && Date.now() - cached.fetchedAt <= this.ttlMs) return cached

    await this.beforeRequest?.()
    this.onRequestAttempt?.(robotsUrl)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(robotsUrl, {
        headers: { "user-agent": this.userAgent },
        redirect: "follow",
        signal: controller.signal,
      })
      const text = response.status === 404 ? null : await response.text().catch(() => null)
      const entry = {
        fetchedAt: Date.now(),
        robotsUrl,
        status: response.status,
        text,
      }
      this.cache.set(origin, entry)
      return entry
    } catch {
      const entry = {
        fetchedAt: Date.now(),
        robotsUrl,
        status: null,
        text: null,
      }
      this.cache.set(origin, entry)
      return entry
    } finally {
      clearTimeout(timer)
    }
  }
}
