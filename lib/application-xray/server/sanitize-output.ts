import { collectRenderedStrings, findProhibitedXRayLanguage } from "../prohibited-language"
import type { ApplicationXRay } from "../types"

const MAX_EXCERPT_CHARS = 360

export function sanitizeApplicationXRayOutput(xray: ApplicationXRay): ApplicationXRay {
  const clean = structuredClone(xray) as ApplicationXRay
  clean.sourceFacts = clean.sourceFacts.map((fact) => ({
    ...fact,
    excerpt: truncateExcerpt(fact.excerpt ?? null),
  }))
  scrubInternalKeys(clean)
  const prohibited = findProhibitedXRayLanguage(collectRenderedStrings(clean))
  if (prohibited.length > 0) {
    throw new Error(`Application X-Ray output failed prohibited-language guard: ${prohibited[0]?.pattern}`)
  }
  return clean
}

function truncateExcerpt(value: string | null): string | null {
  if (!value) return null
  const compact = value.replace(/\s+/g, " ").trim()
  if (compact.length <= MAX_EXCERPT_CHARS) return compact
  return `${compact.slice(0, MAX_EXCERPT_CHARS - 1).trim()}…`
}

function scrubInternalKeys(value: unknown): void {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) scrubInternalKeys(item)
    return
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (/raw_text|rawData|raw_data|internalScores|XRayInternalScores|serviceKey|apiKey/i.test(key)) {
      delete record[key]
      continue
    }
    scrubInternalKeys(record[key])
  }
}
