import type { ApplicationXRay } from "./types"

export const PROHIBITED_XRAY_LANGUAGE = [
  /\byou are eligible\b/i,
  /\byou'?re eligible\b/i,
  /\byou are not eligible\b/i,
  /\byou'?re not eligible\b/i,
  /\bineligible\b/i,
  /\blegally eligible\b/i,
  /\blegally ineligible\b/i,
  /\bguaranteed\b/i,
  /\bfraud\b/i,
  /\bfake\b/i,
  /\bliar\b/i,
  /\bprobability\b/i,
  /\bchance of (?:interview|offer|hire)\b/i,
  /\binterview odds\b/i,
  /\boffer odds\b/i,
]

export function collectRenderedStrings(xray: ApplicationXRay): string[] {
  const strings: string[] = [
    xray.headline,
    xray.hiringReality.headline,
    xray.capability.headline,
    xray.evidence.headline,
    xray.eligibility.headline,
    xray.positioning.headline,
  ]

  for (const dimension of [
    xray.hiringReality,
    xray.capability,
    xray.evidence,
    xray.eligibility,
    xray.positioning,
  ]) {
    for (const finding of dimension.findings) {
      strings.push(finding.statement, finding.explanation)
    }
    for (const gap of dimension.dataGaps) {
      strings.push(gap.label, gap.whyNotDefaulted, gap.resolution?.step ?? "")
    }
  }

  for (const risk of xray.rejectionRisks) {
    strings.push(risk.statement)
  }
  for (const action of xray.actions) {
    strings.push(action.label, action.rationale)
  }
  for (const fact of xray.sourceFacts) {
    strings.push(fact.explanation, fact.excerpt ?? "")
  }

  return strings.filter(Boolean)
}

export function findProhibitedXRayLanguage(strings: string[]): Array<{ pattern: string; text: string }> {
  const matches: Array<{ pattern: string; text: string }> = []
  for (const text of strings) {
    for (const pattern of PROHIBITED_XRAY_LANGUAGE) {
      if (pattern.test(text)) matches.push({ pattern: pattern.source, text })
    }
  }
  return matches
}
