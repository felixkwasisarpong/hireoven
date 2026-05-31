/**
 * Career strategy intent detection — client-safe, no I/O.
 *
 * Must run BEFORE isResearchIntent() in handleSubmit because
 * isResearchIntent() also matches "career direction".
 */

const CAREER_STRATEGY_PRIMARY_RE =
  /^(career\s+(direction|path|strategy|plan|pivot)|what\s+(direction|path|fits)|where\s+should\s+i\s+(focus|go|head)|strategic|long.?term)\b/i

const CAREER_STRATEGY_PHRASE_RE =
  /\b(best\s+(fit|direction|path)\s+for\s+my\s+(profile|background|skills?)|career\s+(direction|pivot|strategy|focus|path)|which\s+(direction|domain|field|sector)\s+(fits|suits|works|matches)|strongest\s+traction|what\s+sector\s+(fits|matches)|skill\s+roadmap|career\s+positioning|where\s+am\s+i\s+getting\s+(traction|results))\b/i

export function isCareerStrategyIntent(message: string): boolean {
  const m = message.trim()
  return CAREER_STRATEGY_PRIMARY_RE.test(m) || CAREER_STRATEGY_PHRASE_RE.test(m)
}
