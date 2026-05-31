/**
 * Job Description Decoder
 *
 * Reads between the lines of a job posting:
 *   - Red flags (unrealistic asks, culture signals, scope creep)
 *   - Posting type: backfill / growth / compliance / evergreen
 *   - Real requirements vs nice-to-haves
 *   - Seniority honesty check (asking 10yr exp for "junior")
 *   - Urgency signals
 */

export type RedFlagSeverity = "critical" | "warning" | "note"

export type RedFlag = {
  id: string
  severity: RedFlagSeverity
  label: string
  excerpt: string     // actual text from JD that triggered this
  explanation: string
}

export type PostingType =
  | "growth"       // net-new headcount
  | "backfill"     // replacing someone who left
  | "evergreen"    // always-open, high churn role
  | "compliance"   // posted to satisfy policy, probably already filled
  | "unknown"

export type SeniorityHonestyResult = {
  titleLevel: string        // what the title says (e.g. "Junior")
  impliedLevel: string      // what the requirements imply (e.g. "Senior")
  mismatch: boolean
  yearsRequested: number | null
  explanation: string
}

export type JDDecodeResult = {
  redFlags: RedFlag[]
  greenSignals: string[]
  postingType: PostingType
  postingTypeConfidence: number   // 0–1
  postingTypeReason: string
  seniority: SeniorityHonestyResult
  mustHaves: string[]             // actual hard requirements
  niceToHaves: string[]           // fluff / preferred
  hiddenExpectations: string[]    // unstated but implied (e.g. "will work weekends")
  urgencySignal: "high" | "medium" | "low"
  tldr: string                    // one-sentence honest summary
  overallScore: number            // 0–100 how healthy/honest this JD is
}

// ── Rule-based pre-pass (fast, no AI call) ────────────────────────────────────

const RED_FLAG_RULES: Array<{
  id: string
  severity: RedFlagSeverity
  label: string
  pattern: RegExp
  explanation: string
}> = [
  {
    id: "rockstar",
    severity: "warning",
    label: "Rockstar/Ninja culture signal",
    pattern: /\b(rockstar|ninja|wizard|guru|10x|unicorn|superhero)\b/i,
    explanation: "Ego-driven language often signals a culture that values heroics over sustainability.",
  },
  {
    id: "years_overreach",
    severity: "critical",
    label: "Experience overreach",
    pattern: /\b(8|9|10|12|15)\+?\s*years?.{0,30}(required|minimum|must)\b/i,
    explanation: "Requiring 8+ years may indicate unrealistic expectations or an attempt to screen out qualified candidates to justify internal hiring.",
  },
  {
    id: "unpaid_overtime",
    severity: "critical",
    label: "Implicit overwork signal",
    pattern: /\b(fast.?paced|wear many hats|startup mentality|do what it takes|24\/7|always on|entrepreneurial spirit)\b/i,
    explanation: "Common euphemisms for unpaid overtime or poor work-life balance.",
  },
  {
    id: "vague_comp",
    severity: "warning",
    label: "Vague or missing compensation",
    pattern: /\b(competitive salary|market rate|commensurate with experience|negotiable)\b/i,
    explanation: "Companies that hide comp ranges often pay below market. Research carefully before proceeding.",
  },
  {
    id: "culture_fit",
    severity: "note",
    label: "\"Culture fit\" screening risk",
    pattern: /\bculture.?fit\b/i,
    explanation: "Culture fit is a valid signal but can also be a proxy for bias. Look for specific values language instead.",
  },
  {
    id: "tech_stack_overload",
    severity: "warning",
    label: "Tech stack overload",
    pattern: /(\b\w+\b[,\s]+){8,}\b(required|must have|proficient)\b/i,
    explanation: "Requiring mastery of 8+ specific tools often means the role has unclear scope or the team is understaffed.",
  },
  {
    id: "evergreen_signal",
    severity: "note",
    label: "Possible evergreen posting",
    pattern: /\b(continuously|always looking|rolling basis|ongoing)\b/i,
    explanation: "Always-open postings often indicate high churn or a pipeline-building exercise with no immediate opening.",
  },
  {
    id: "degree_gatekeeping",
    severity: "note",
    label: "Degree gatekeeping",
    pattern: /\b(bachelor'?s?|master'?s?|phd|degree).{0,20}required\b/i,
    explanation: "Degree requirements for roles where skills matter more may unnecessarily narrow the talent pool — and the team.",
  },
]

const GREEN_SIGNAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bsalary range\b|\$[\d,]+\s*[-–]\s*\$[\d,]+/i, label: "Transparent salary range posted" },
  { pattern: /\bwork.?life balance\b/i, label: "Work-life balance explicitly mentioned" },
  { pattern: /\bflexible.?hours?\b|\bflexible.?schedule\b/i, label: "Flexible schedule offered" },
  { pattern: /\bparental leave\b/i, label: "Parental leave mentioned" },
  { pattern: /\blearning.{0,20}budget\b|\beducation.{0,20}budget\b/i, label: "Learning & development budget" },
  { pattern: /\bpsychological safety\b/i, label: "Psychological safety explicitly valued" },
  { pattern: /\bremote.?first\b/i, label: "Remote-first culture" },
]

function detectSeniority(title: string, description: string): SeniorityHonestyResult {
  const titleLower = title.toLowerCase()
  const yearsMatch = description.match(/(\d+)\+?\s*years?\s*(?:of\s*)?(?:experience|exp)/i)
  const yearsRequested = yearsMatch ? parseInt(yearsMatch[1], 10) : null

  let titleLevel = "unspecified"
  if (/\b(junior|jr\.?|entry.?level|associate|new grad)\b/i.test(titleLower)) titleLevel = "junior"
  else if (/\b(senior|sr\.?|staff|principal|lead)\b/i.test(titleLower)) titleLevel = "senior"
  else if (/\b(manager|director|vp|head of)\b/i.test(titleLower)) titleLevel = "management"
  else titleLevel = "mid-level"

  let impliedLevel = "mid-level"
  if (yearsRequested !== null) {
    if (yearsRequested <= 2) impliedLevel = "junior"
    else if (yearsRequested <= 5) impliedLevel = "mid-level"
    else if (yearsRequested <= 8) impliedLevel = "senior"
    else impliedLevel = "staff/principal"
  }

  const mismatch = titleLevel === "junior" && (impliedLevel === "senior" || impliedLevel === "staff/principal")

  return {
    titleLevel,
    impliedLevel,
    mismatch,
    yearsRequested,
    explanation: mismatch
      ? `The title says "${titleLevel}" but the requirements imply "${impliedLevel}" (${yearsRequested}+ years). This is a common bait-and-switch.`
      : `Title and requirements are broadly aligned.`,
  }
}

function detectPostingType(description: string): Pick<JDDecodeResult, "postingType" | "postingTypeConfidence" | "postingTypeReason"> {
  const d = description.toLowerCase()
  if (/\b(backfill|replacement|due to growth|fill the gap)\b/.test(d)) {
    return { postingType: "backfill", postingTypeConfidence: 0.8, postingTypeReason: "Explicit replacement language detected." }
  }
  if (/\b(expanding|growing team|new team|new department|headcount)\b/.test(d)) {
    return { postingType: "growth", postingTypeConfidence: 0.75, postingTypeReason: "Team expansion language detected." }
  }
  if (/\b(continuously|always looking|rolling basis|ongoing)\b/.test(d)) {
    return { postingType: "evergreen", postingTypeConfidence: 0.7, postingTypeReason: "Always-open posting signals detected." }
  }
  if (/\b(equal opportunity|eeo|affirmative action)\b/.test(d) && !/\bopen\b/.test(d)) {
    return { postingType: "compliance", postingTypeConfidence: 0.45, postingTypeReason: "Heavy compliance language with few open role signals — may be a pipeline post." }
  }
  return { postingType: "unknown", postingTypeConfidence: 0.3, postingTypeReason: "No strong signals detected." }
}

export function runRuleBasedDecode(
  title: string,
  description: string,
): Pick<JDDecodeResult, "redFlags" | "greenSignals" | "postingType" | "postingTypeConfidence" | "postingTypeReason" | "seniority" | "urgencySignal"> {
  const redFlags: RedFlag[] = []
  for (const rule of RED_FLAG_RULES) {
    const match = description.match(rule.pattern)
    if (match) {
      redFlags.push({
        id: rule.id,
        severity: rule.severity,
        label: rule.label,
        excerpt: match[0].trim(),
        explanation: rule.explanation,
      })
    }
  }

  const greenSignals: string[] = []
  for (const g of GREEN_SIGNAL_PATTERNS) {
    if (g.pattern.test(description)) greenSignals.push(g.label)
  }

  const urgencySignal: JDDecodeResult["urgencySignal"] =
    /\b(immediately|asap|urgent|start date.{0,20}soon)\b/i.test(description) ? "high"
    : /\b(flexible start|whenever you.?re ready)\b/i.test(description) ? "low"
    : "medium"

  return {
    redFlags,
    greenSignals,
    seniority: detectSeniority(title, description),
    urgencySignal,
    ...detectPostingType(description),
  }
}
