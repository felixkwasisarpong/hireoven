import { SKILL_DICTIONARY, type SkillEntry } from "./skills-dictionary"

/**
 * Pre-compile one regex per skill (alternation across aliases) at module load.
 * Word-boundary on both ends so "rust" doesn't match "trust". Aliases that
 * include their own `\b` opt out (used for short tokens like "r" or "sre"
 * where the boundary placement is non-default).
 */

function buildPattern(alias: string): string {
  // If the alias already includes a `\b`, trust the caller's boundary placement.
  if (alias.includes("\\b")) return alias
  // Otherwise wrap with default word boundaries.
  return `\\b${alias}\\b`
}

type CompiledSkill = { canonical: string; regex: RegExp }

const COMPILED: CompiledSkill[] = SKILL_DICTIONARY.map((entry: SkillEntry) => ({
  canonical: entry.canonical,
  regex: new RegExp(entry.aliases.map(buildPattern).join("|"), "i"),
}))

export function extractSkills(text: string | null | undefined): string[] {
  if (!text) return []
  const found = new Set<string>()
  for (const skill of COMPILED) {
    if (skill.regex.test(text)) {
      found.add(skill.canonical)
    }
  }
  return [...found].sort()
}

/**
 * Union existing skills with newly-extracted ones, deduplicating
 * case-insensitively but preserving the canonical casing from whichever side
 * provided the skill first.
 */
export function mergeSkills(existing: string[] | null, extracted: string[]): string[] {
  const seenLower = new Set<string>()
  const out: string[] = []
  for (const skill of [...(existing ?? []), ...extracted]) {
    const key = skill.trim().toLowerCase()
    if (!key || seenLower.has(key)) continue
    seenLower.add(key)
    out.push(skill.trim())
  }
  return out.sort()
}
