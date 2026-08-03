/**
 * Lightweight, deterministic JD context extraction: the target title and the
 * industry/domain signals a posting carries. Used to (a) mirror the posting's
 * title into the résumé summary and (b) surface *transferable* domain relevance —
 * e.g. a candidate with core-banking / payments integration experience applying to
 * a B2B distribution shop should have that adjacency named, not buried.
 *
 * This grounds the LLM prompts (which may only see a truncated JD excerpt) and is
 * cheap enough to run on every analysis with no API call.
 */

export interface JdDomain {
  /** Short industry label, e.g. "B2B / distribution". */
  label: string
  /** How to truthfully frame adjacent experience toward this domain. */
  framingHint: string
}

interface DomainRule {
  label: string
  framingHint: string
  patterns: RegExp[]
}

const DOMAIN_RULES: DomainRule[] = [
  {
    label: "B2B / distribution",
    framingHint:
      "Emphasize any B2B, wholesale, catalog, inventory, procurement, supply-chain, or enterprise-integration experience as directly relevant to a distribution business.",
    patterns: [/\bdistribution\b/i, /\bwholesale\b/i, /\bprocurement\b/i, /\binventory\b/i, /\bsupply chain\b/i, /\bb2b\b/i, /\bindustrial\b/i],
  },
  {
    label: "automotive / parts",
    framingHint:
      "Connect any parts-catalog, e-commerce catalog, or product-data experience to automotive parts distribution where truthful.",
    patterns: [/\bautomotive\b/i, /\bauto parts\b/i, /\baftermarket\b/i, /\bvehicle(s)?\b/i],
  },
  {
    label: "payments / fintech",
    framingHint:
      "Foreground payment processing, transaction systems, card networks, and financial-integration experience.",
    patterns: [/\bpayment(s)?\b/i, /\bfintech\b/i, /\bcard network\b/i, /\btransaction(s)?\b/i, /\biso ?8583\b/i, /\bbanking\b/i],
  },
  {
    label: "healthcare",
    framingHint: "Surface any HIPAA, clinical, EHR, or regulated-data experience.",
    patterns: [/\bhealthcare\b/i, /\bclinical\b/i, /\bhipaa\b/i, /\behr\b/i, /\bpatient(s)?\b/i],
  },
  {
    label: "e-commerce / retail",
    framingHint: "Emphasize checkout, catalog, order, and high-traffic consumer-facing experience.",
    patterns: [/\be-?commerce\b/i, /\bretail\b/i, /\bcheckout\b/i, /\bmarketplace\b/i, /\bshopping\b/i],
  },
  {
    label: "enterprise / internal tooling",
    framingHint:
      "Highlight experience integrating with enterprise systems (ERP, CRM, core platforms) and building internal automation.",
    patterns: [/\benterprise\b/i, /\berp\b/i, /\bsalesforce\b/i, /\bsap\b/i, /\bas ?\/?400\b/i, /\bibm i\b/i, /\binternal tool/i],
  },
]

/** Detect the industry/domain signals present in a job description. */
export function detectJdDomains(jd: string): JdDomain[] {
  if (!jd || !jd.trim()) return []
  const out: JdDomain[] = []
  for (const rule of DOMAIN_RULES) {
    const hits = rule.patterns.reduce((n, re) => n + (re.test(jd) ? 1 : 0), 0)
    if (hits > 0) out.push({ label: rule.label, framingHint: rule.framingHint })
  }
  return out
}

/**
 * Best-effort target-title extraction from a job posting. Prefers an explicit
 * `jobTitle` when the caller has one; otherwise scans the first lines of the JD
 * for a recognizable role title. Returns null when nothing confident is found.
 */
export function resolveTargetTitle(jd: string, explicitTitle?: string | null): string | null {
  const t = (explicitTitle ?? "").trim()
  if (t) return t
  if (!jd || !jd.trim()) return null

  const ROLE_RE =
    /\b((?:senior|staff|principal|lead|junior|sr\.?|jr\.?)\s+)?((?:ai|ml|genai|generative ai|software|backend|full[\s-]?stack|frontend|data|platform|cloud|devops|site reliability|machine learning|security|systems)\s+){0,3}(engineer|developer|scientist|architect|specialist|manager)\b/i

  for (const line of jd.split(/\r?\n/).slice(0, 6)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length > 80) continue
    const m = trimmed.match(ROLE_RE)
    if (m) return m[0].replace(/\s+/g, " ").trim()
  }
  const m = jd.match(ROLE_RE)
  return m ? m[0].replace(/\s+/g, " ").trim() : null
}
