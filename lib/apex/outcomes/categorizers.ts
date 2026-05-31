/**
 * Scout Outcome Categorizers — V2
 *
 * Pure keyword-based inference of role category and sector from job title
 * and company context. No external calls. Used at outcome-recording time to
 * enrich the scout_outcomes row so future learning queries don't re-derive it.
 *
 * Privacy: only reads job title + company name — never infers demographic traits.
 */

// ── Role categories ───────────────────────────────────────────────────────────

export type RoleCategory =
  | "backend"
  | "frontend"
  | "fullstack"
  | "platform"
  | "ml_ai"
  | "data"
  | "devops_sre"
  | "security"
  | "mobile"
  | "product"
  | "design"
  | "management"
  | "other"

export const ROLE_CATEGORY_LABELS: Record<RoleCategory, string> = {
  backend:    "Backend Engineering",
  frontend:   "Frontend Engineering",
  fullstack:  "Full-Stack Engineering",
  platform:   "Platform / Infrastructure",
  ml_ai:      "ML / AI Engineering",
  data:       "Data Engineering / Analytics",
  devops_sre: "DevOps / SRE",
  security:   "Security Engineering",
  mobile:     "Mobile Engineering",
  product:    "Product Management",
  design:     "Design / UX",
  management: "Engineering Management",
  other:      "Other",
}

// Ordered by specificity — first match wins
const ROLE_PATTERNS: Array<[RoleCategory, RegExp]> = [
  ["ml_ai",      /\b(ml|machine.?learn|ai engineer|llm|nlp|model|data.?scien|applied.?(ml|ai)|research.?engineer|foundation.?model)\b/i],
  ["platform",   /\b(platform|infrastructure|infra engineer|distributed.?systems|systems.?engineer|site.?reliability|internal.?tools)\b/i],
  ["devops_sre", /\b(devops|sre|devsecops|k8s|kubernetes|terraform|ci.?cd|reliability.?engineer|cloud.?platform)\b/i],
  ["data",       /\b(data.?eng|analytics.?eng|pipeline|warehouse|data.?platform|etl|spark|kafka|dbt|analytics)\b/i],
  ["security",   /\b(security|appsec|infosec|pentest|cryptograph|red.?team|blue.?team|soc|threat)\b/i],
  ["mobile",     /\b(mobile|ios|android|swift|kotlin|react.?native|flutter|cross.?platform)\b/i],
  ["frontend",   /\b(frontend|front.?end|react|angular|vue|svelte|ui.?eng|ux.?eng|web.?dev)\b/i],
  ["fullstack",  /\b(fullstack|full.?stack|full stack)\b/i],
  ["backend",    /\b(backend|back.?end|server.?side|api.?eng|node.?js|ruby|go.?lang|rust|java|spring|django|rails)\b/i],
  ["product",    /\b(product.?manager|pm\b|program.?manager|product.?lead)\b/i],
  ["design",     /\b(ux|ui.?designer|product.?design|visual.?design|interaction.?design|figma)\b/i],
  ["management", /\b(engineering.?manager|staff.?eng|principal.?eng|vp.?eng|director.?eng|head.?of.?eng|tech.?lead.+manage)\b/i],
]

export function inferRoleCategory(title: string): RoleCategory {
  for (const [category, pattern] of ROLE_PATTERNS) {
    if (pattern.test(title)) return category
  }
  return "other"
}

// ── Sectors ───────────────────────────────────────────────────────────────────

export type JobSector =
  | "fintech"
  | "ai_infra"
  | "healthtech"
  | "enterprise_saas"
  | "ecommerce"
  | "gaming"
  | "adtech"
  | "crypto_web3"
  | "edtech"
  | "startup"
  | "big_tech"
  | "consulting"
  | "other"

export const JOB_SECTOR_LABELS: Record<JobSector, string> = {
  fintech:         "Fintech",
  ai_infra:        "AI / ML Infrastructure",
  healthtech:      "Healthtech / Biotech",
  enterprise_saas: "Enterprise SaaS",
  ecommerce:       "E-commerce / Retail",
  gaming:          "Gaming",
  adtech:          "Ad Tech / Marketing Tech",
  crypto_web3:     "Crypto / Web3",
  edtech:          "EdTech",
  startup:         "Startup",
  big_tech:        "Big Tech",
  consulting:      "Consulting / Agency",
  other:           "Other",
}

// Ordered — first match wins; use combined title + company + industry string
const SECTOR_PATTERNS: Array<[JobSector, RegExp]> = [
  ["ai_infra",        /\b(openai|anthropic|hugging.?face|deepmind|cohere|together.?ai|ml.?platform|ai.?infra|foundation.?model|llm.?infra)\b/i],
  ["crypto_web3",     /\b(crypto|blockchain|web3|defi|nft|solana|ethereum|coinbase|binance|dao)\b/i],
  ["fintech",         /\b(fintech|payments?|banking|financial.?(tech|services)|stripe|plaid|square|brex|chime|nerdwallet|robinhood|klarna)\b/i],
  ["healthtech",      /\b(health|medical|pharma|biotech|clinical|hospital|med.?tech|genomic|epic.?systems|veeva|athena)\b/i],
  ["gaming",          /\b(gaming|game.?(studio|dev|engine)|unity|unreal|roblox|activision|riot|epic.?games)\b/i],
  ["adtech",          /\b(adtech|ad.?tech|advertising.?tech|programmatic|martech|marketing.?tech|rtb|dsp|attribution)\b/i],
  ["edtech",          /\b(edtech|ed.?tech|e.?learning|online.?education|coursera|duolingo|udemy|canvas)\b/i],
  ["enterprise_saas", /\b(enterprise|b2b.?saas|crm|erp|salesforce|workday|servicenow|sap\b|oracle\b|hubspot|zendesk)\b/i],
  ["ecommerce",       /\b(ecommerce|e.?commerce|shopify|amazon|marketplace|logistics|fulfillment|wayfair)\b/i],
  ["big_tech",        /\b(google|microsoft|apple|meta\b|amazon.?(aws|inc)?|netflix|uber|airbnb|lyft|twitter|linkedin)\b/i],
  ["consulting",      /\b(consulting|agency|staffing|contractor|freelance|mckinsey|bcg|accenture|deloitte|pwc)\b/i],
]

export function inferSector(
  title: string,
  companyName: string,
  industry?: string | null,
): JobSector | null {
  const combined = `${title} ${companyName} ${industry ?? ""}`.toLowerCase()
  for (const [sector, pattern] of SECTOR_PATTERNS) {
    if (pattern.test(combined)) return sector
  }
  return null
}

// ── Work mode from job record ─────────────────────────────────────────────────

export function inferWorkMode(
  isRemote: boolean | null | undefined,
  title?: string,
  location?: string | null,
): "remote" | "hybrid" | "onsite" | null {
  if (isRemote === true) return "remote"

  const combined = `${title ?? ""} ${location ?? ""}`.toLowerCase()
  if (/\bhybrid\b/.test(combined)) return "hybrid"
  if (/\bremote\b/.test(combined)) return "remote"
  if (/\b(onsite|on.?site|in.?office|in.?person)\b/.test(combined)) return "onsite"

  if (isRemote === false) return "onsite"
  return null
}
