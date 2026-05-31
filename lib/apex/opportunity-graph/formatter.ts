/**
 * Format opportunity graph data for Claude's system context.
 *
 * All claims are phrased cautiously — no guarantees, no fabrication.
 */

import type { OpportunityGraphResponse } from "./types"

export function formatOpportunitiesForClaude(graph: OpportunityGraphResponse): string {
  if (!graph) return ""

  const lines: string[] = ["Opportunity Graph (evidence-based relationships):"]
  lines.push("Note: All relationships derived from skill overlap and hiring patterns. Phrase cautiously.")
  lines.push("")

  // Similar jobs
  if (graph.similarJobs.length > 0) {
    lines.push("Similar Active Roles:")
    for (const j of graph.similarJobs.slice(0, 4)) {
      const skills = j.overlapSkills.slice(0, 3).join(", ")
      const sponsor = j.sponsorsH1b ? " [H-1B sponsor]" : ""
      lines.push(`  - ${j.title} at ${j.companyName}${sponsor} — ${j.overlapCount} overlapping skills: ${skills}`)
    }
    lines.push("")
  }

  // Adjacent companies
  if (graph.adjacentCompanies.length > 0) {
    lines.push("Companies Hiring Similar Talent:")
    for (const c of graph.adjacentCompanies.slice(0, 3)) {
      const sponsor = c.sponsorsH1b ? " [H-1B sponsor]" : ""
      lines.push(`  - ${c.companyName}${sponsor} — ${c.matchingJobCount} matching role${c.matchingJobCount !== 1 ? "s" : ""} (${c.industry ?? "sector unknown"})`)
    }
    lines.push("")
  }

  // Skill unlocks
  if (graph.skillUnlocks.length > 0) {
    lines.push("Skill Unlock Opportunities:")
    for (const s of graph.skillUnlocks.slice(0, 3)) {
      lines.push(`  - ${s.skill}: appears in ${s.jobCount} active roles, ~${s.netUnlock} net new positions unlocked`)
    }
    lines.push("")
  }

  // Career progression
  if ((graph.careerProgression ?? []).length > 0) {
    lines.push("Adjacent Career Directions (cautious — based on role patterns only):")
    for (const p of (graph.careerProgression ?? []).slice(0, 2)) {
      const gap = p.skillGap.length > 0 ? ` | Gap: ${p.skillGap.slice(0, 2).join(", ")}` : ""
      lines.push(`  - ${p.targetRole} (${p.seniorityStep})${gap}`)
    }
  }

  return lines.join("\n")
}
