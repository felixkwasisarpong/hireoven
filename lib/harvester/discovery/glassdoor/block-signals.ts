export type GlassdoorBlockSignalInput = {
  status: number | null
  finalUrl: string | null
  html?: string | null
}

export type GlassdoorBlockSignal = {
  blocked: boolean
  reason: string | null
}

const BLOCKING_STATUSES = new Set([401, 403, 429, 503])

const BLOCKING_URL_RE =
  /\/(?:profile\/login|login|member|captcha|bot-detection|security|error\/bot|account\/login)\b/i

const BLOCKING_HTML_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  { reason: "captcha", re: /\b(?:captcha|g-recaptcha|hcaptcha)\b/i },
  { reason: "bot_check", re: /\b(?:bot check|bot-check|bot detection|automated access|unusual traffic)\b/i },
  { reason: "human_verification", re: /\b(?:verify you are human|are you a human|checking your browser)\b/i },
  { reason: "cloudflare_challenge", re: /\b(?:cf-chl-|cloudflare|turnstile)\b/i },
  { reason: "datadome_challenge", re: /\bdatadome\b/i },
  { reason: "login_wall", re: /\b(?:sign in to view|log in to view|login to view|join glassdoor)\b/i },
  { reason: "access_denied", re: /\b(?:access denied|access to this page has been denied)\b/i },
  { reason: "rate_limited", re: /\b(?:too many requests|rate limit|temporarily blocked)\b/i },
]

export function detectGlassdoorBlockSignal(
  input: GlassdoorBlockSignalInput
): GlassdoorBlockSignal {
  if (input.status && BLOCKING_STATUSES.has(input.status)) {
    return { blocked: true, reason: `http_${input.status}` }
  }

  if (input.finalUrl && BLOCKING_URL_RE.test(input.finalUrl)) {
    return { blocked: true, reason: "login_or_access_control_redirect" }
  }

  const html = input.html?.slice(0, 500_000) ?? ""
  for (const pattern of BLOCKING_HTML_PATTERNS) {
    if (pattern.re.test(html)) return { blocked: true, reason: pattern.reason }
  }

  return { blocked: false, reason: null }
}
