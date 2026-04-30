/**
 * Opportunity Graph Generator — pure functions, no I/O.
 *
 * Takes DB query results and produces OpportunityRecommendation[] for Scout.
 * All scoring is evidence-based (skill counts, job counts) — never invented.
 *
 * Safety: every recommendation has an evidence[] array with the raw data
 * that justified it. Confidence levels reflect sample sizes.
 */

import type {
  OpportunityRecommendation,
  SimilarJobHit,
  AdjacentCompanyHit,
  SkillUnlockHit,
  CareerProgressionHit,
} from "./types"

// ── Jaccard similarity ────────────────────────────────────────────────────────

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a.map((s) => s.toLowerCase()))
  const setB = new Set(b.map((s) => s.toLowerCase()))
  const intersection = [...setA].filter((s) => setB.has(s)).length
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : Math.round((intersection / union) * 100) / 100
}

/** Find the actual overlapping skills between two skill lists (case-insensitive). */
export function skillOverlap(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((s) => s.toLowerCase()))
  return a.filter((s) => setB.has(s.toLowerCase()))
}

// ── Confidence from sample size ───────────────────────────────────────────────

function confidenceFromCount(count: number, threshold: { high: number; medium: number }): "high" | "medium" | "low" {
  if (count >= threshold.high) return "high"
  if (count >= threshold.medium) return "medium"
  return "low"
}

// ── Similar job recommendations ───────────────────────────────────────────────

export function buildSimilarJobRecommendations(
  hits: SimilarJobHit[],
  currentJobTitle: string,
): OpportunityRecommendation[] {
  return hits.slice(0, 3).map((hit, i) => {
    const confidence = confidenceFromCount(hit.overlapCount, { high: 5, medium: 2 })
    return {
      id:          `similar-job-${hit.jobId}`,
      type:        "similar_job" as const,
      title:       hit.title,
      subtitle:    hit.companyName,
      description: `${hit.overlapCount} skill${hit.overlapCount !== 1 ? "s" : ""} overlap with ${currentJobTitle}.${hit.sponsorsH1b ? " Company has H-1B sponsorship history." : ""}`,
      evidence:    [
        `${hit.overlapCount} shared skill${hit.overlapCount !== 1 ? "s" : ""}: ${hit.overlapSkills.slice(0, 4).join(", ")}`,
        hit.sponsorsH1b ? "H-1B sponsor history confirmed" : "",
        hit.isRemote    ? "Remote position available" : "",
      ].filter(Boolean),
      query:       `Tell me about the ${hit.title} role at ${hit.companyName} and how it compares to my current focus`,
      confidence,
      entityIds:   [hit.jobId, hit.companyId],
    }
  })
}

// ── Adjacent company recommendations ─────────────────────────────────────────

export function buildAdjacentCompanyRecommendations(
  hits: AdjacentCompanyHit[],
  userSkills: string[],
): OpportunityRecommendation[] {
  return hits.slice(0, 3).map((hit) => {
    const confidence = confidenceFromCount(hit.matchingJobCount, { high: 5, medium: 2 })
    return {
      id:          `adjacent-company-${hit.companyId}`,
      type:        "adjacent_company" as const,
      title:       `${hit.companyName}`,
      subtitle:    hit.industry ?? undefined,
      description: `${hit.matchingJobCount} open role${hit.matchingJobCount !== 1 ? "s" : ""} matching your profile.${hit.sponsorsH1b ? " Strong H-1B sponsorship history." : ""}`,
      evidence:    [
        `${hit.matchingJobCount} active role${hit.matchingJobCount !== 1 ? "s" : ""} matching your skill set`,
        hit.commonSkills.length > 0 ? `Common skills: ${hit.commonSkills.slice(0, 3).join(", ")}` : "",
        hit.sponsorsH1b ? "H-1B sponsorship history confirmed" : "",
        hit.industry ? `Sector: ${hit.industry}` : "",
      ].filter(Boolean),
      query:       `What roles does ${hit.companyName} hire for that match my background?`,
      confidence,
      entityIds:   [hit.companyId],
    }
  })
}

// ── Skill unlock recommendations ──────────────────────────────────────────────

export function buildSkillUnlockRecommendations(
  hits: SkillUnlockHit[],
): OpportunityRecommendation[] {
  return hits.slice(0, 2).map((hit) => ({
    id:          `skill-unlock-${hit.skill.replace(/\s+/g, "-")}`,
    type:        "skill_unlock" as const,
    title:       `Add ${hit.skill} to your profile`,
    description: `${hit.skill} appears in ${hit.jobCount} active role${hit.jobCount !== 1 ? "s" : ""}. Adding it could unlock ~${hit.netUnlock} additional position${hit.netUnlock !== 1 ? "s" : ""} matching your background.`,
    evidence:    [
      `${hit.jobCount} active job${hit.jobCount !== 1 ? "s" : ""} require ${hit.skill}`,
      `~${hit.netUnlock} net new positions unlocked beyond your current matches`,
      hit.categories.length > 0 ? `Common in: ${hit.categories.slice(0, 2).join(", ")}` : "",
    ].filter(Boolean),
    query:       `What jobs would I qualify for if I added ${hit.skill} to my resume?`,
    confidence:  confidenceFromCount(hit.jobCount, { high: 20, medium: 8 }),
    entityIds:   [hit.skill],
  }))
}

// ── Career progression recommendations ───────────────────────────────────────

export function buildCareerProgressionRecommendations(
  hits: CareerProgressionHit[],
): OpportunityRecommendation[] {
  return hits.slice(0, 2).map((hit, i) => ({
    id:          `career-prog-${i}`,
    type:        "career_progression" as const,
    title:       hit.targetRole,
    description: hit.description,
    evidence:    hit.skillGap.length > 0
      ? [`Skill gap: ${hit.skillGap.slice(0, 3).join(", ")}`]
      : ["Your current profile is closely aligned to this direction"],
    query:       `What would I need to transition into ${hit.targetRole} roles?`,
    confidence:  hit.confidence,
    entityIds:   [],
  }))
}

// ── Sponsorship alternative recommendations ───────────────────────────────────

export function buildSponsorshipAlternatives(
  adjacentCompanies: AdjacentCompanyHit[],
  currentCompanyName: string,
): OpportunityRecommendation[] {
  const sponsors = adjacentCompanies.filter((c) => c.sponsorsH1b).slice(0, 2)
  return sponsors.map((company) => ({
    id:          `sponsorship-alt-${company.companyId}`,
    type:        "sponsorship_alternative" as const,
    title:       `${company.companyName} — sponsorship-friendly alternative`,
    subtitle:    company.industry ?? undefined,
    description: `Similar hiring profile to ${currentCompanyName} with confirmed H-1B sponsorship history. ${company.matchingJobCount} matching role${company.matchingJobCount !== 1 ? "s" : ""} active.`,
    evidence:    [
      "H-1B sponsorship history confirmed",
      `${company.matchingJobCount} active matching role${company.matchingJobCount !== 1 ? "s" : ""}`,
      company.industry ? `Same sector: ${company.industry}` : "",
    ].filter(Boolean),
    query:       `Does ${company.companyName} sponsor H-1B visas for my target roles?`,
    confidence:  "medium" as const,
    entityIds:   [company.companyId],
  }))
}

// ── Main generator ────────────────────────────────────────────────────────────

type GeneratorInput = {
  currentJobTitle:       string
  currentCompanyName:    string
  userSkills:            string[]
  similarJobs:           SimilarJobHit[]
  adjacentCompanies:     AdjacentCompanyHit[]
  skillUnlocks:          SkillUnlockHit[]
  careerProgression:     CareerProgressionHit[]
  sponsorshipRequired:   boolean
}

export function generateRecommendations(input: GeneratorInput): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = []

  // Always include similar jobs and adjacent companies
  recs.push(...buildSimilarJobRecommendations(input.similarJobs, input.currentJobTitle))
  recs.push(...buildAdjacentCompanyRecommendations(input.adjacentCompanies, input.userSkills))

  // Sponsorship alternatives take priority when user needs sponsorship
  if (input.sponsorshipRequired) {
    recs.push(...buildSponsorshipAlternatives(input.adjacentCompanies, input.currentCompanyName))
  }

  // Skill unlocks — always useful
  recs.push(...buildSkillUnlockRecommendations(input.skillUnlocks))

  // Career progression — last, most speculative
  recs.push(...buildCareerProgressionRecommendations(input.careerProgression))

  // Deduplicate by id, sort by confidence
  const seen = new Set<string>()
  const ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
  return recs
    .filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
    .sort((a, b) => (ORDER[a.confidence] ?? 1) - (ORDER[b.confidence] ?? 1))
    .slice(0, 8)
}
