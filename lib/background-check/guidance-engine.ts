/**
 * Background Check Pre-Awareness Guidance Engine
 *
 * Generates personalized, plain-English guidance based on a user's record type,
 * timing, state, and target industries. No user data is stored — all computation
 * is stateless and in-memory.
 */

import { getPostgresPool } from "@/lib/postgres/server"

// ── Input / Output types ─────────────────────────────────────────────────────

export type RecordType =
  | "criminal_conviction"
  | "arrest_no_conviction"
  | "credit_issues"
  | "employment_gap"
  | "dismissed_charges"
  | "expunged_record"

export type YearsAgo = "under_3" | "3_to_7" | "7_to_10" | "over_10"

export type GuidanceInput = {
  recordTypes: RecordType[]
  yearsAgo: YearsAgo
  stateCode: string
  industries: string[]
}

export type ProtectionItem = {
  icon: string
  title: string
  detail: string
  tag: string
  severity: "protected" | "partial" | "exposed"
}

export type IndustryBreakdownItem = {
  icon: string
  label: string
  checkDescription: string
  verdict: string
  severity: "low" | "medium" | "high"
}

export type ActionItem = {
  icon: string
  title: string
  detail: string
}

export type GuidanceResult = {
  outlook: "strong" | "moderate" | "challenging" | "difficult"
  tldr: string
  stateProtections: ProtectionItem[]
  industryBreakdown: IndustryBreakdownItem[]
  actionItems: ActionItem[]
  disclaimer: string
}

// ── Static reference data ────────────────────────────────────────────────────

const RECORD_LABELS: Record<RecordType, string> = {
  criminal_conviction: "criminal conviction",
  arrest_no_conviction: "arrest without conviction",
  credit_issues: "credit issues",
  employment_gap: "employment gap",
  dismissed_charges: "dismissed charges",
  expunged_record: "expunged record",
}

const YEARS_AGO_LABELS: Record<YearsAgo, string> = {
  under_3: "under 3 years ago",
  "3_to_7": "3–7 years ago",
  "7_to_10": "7–10 years ago",
  over_10: "more than 10 years ago",
}

const HIGH_RISK_INDUSTRIES = new Set(["finance", "healthcare", "government"])
const MEDIUM_RISK_INDUSTRIES = new Set(["logistics"])
const LOW_RISK_INDUSTRIES = new Set(["tech", "retail", "startup", "education"])

// "education" is high conviction risk but low for non-contact roles —
// we handle this by checking the specific conviction_risk_level from DB.

const LOOKBACK_SENSITIVE_TYPES: RecordType[] = [
  "criminal_conviction",
  "arrest_no_conviction",
  "dismissed_charges",
]

function isRecentRecord(yearsAgo: YearsAgo): boolean {
  return yearsAgo === "under_3" || yearsAgo === "3_to_7"
}

function isOldRecord(yearsAgo: YearsAgo): boolean {
  return yearsAgo === "7_to_10" || yearsAgo === "over_10"
}

function hasCriminalRecord(recordTypes: RecordType[]): boolean {
  return (
    recordTypes.includes("criminal_conviction") ||
    recordTypes.includes("arrest_no_conviction") ||
    recordTypes.includes("dismissed_charges")
  )
}

// ── Outlook logic ────────────────────────────────────────────────────────────

function computeOutlook(
  input: GuidanceInput,
  hasBanTheBox: boolean,
  industryRiskLevels: string[]
): GuidanceResult["outlook"] {
  const { recordTypes, yearsAgo, industries } = input

  const hasHighRisk = industryRiskLevels.includes("high") || industries.some((i) => HIGH_RISK_INDUSTRIES.has(i))
  const hasLowRisk = industryRiskLevels.every((r) => r === "low")
  const recentCriminal = hasCriminalRecord(recordTypes) && isRecentRecord(yearsAgo)
  const oldRecord = isOldRecord(yearsAgo)

  // Difficult: high-risk industry + recent criminal conviction
  if (hasHighRisk && recentCriminal) return "difficult"

  // Strong: ban-the-box state + record over 7 years + low-risk industries
  if (hasBanTheBox && oldRecord && hasLowRisk) return "strong"

  // Moderate: ban-the-box state OR record 7+ years + medium-risk industries
  if (hasBanTheBox || oldRecord) return "moderate"

  // Challenging: no ban-the-box + recent record OR targeting high-risk industry
  if (!hasBanTheBox && (isRecentRecord(yearsAgo) || hasHighRisk)) return "challenging"

  return "moderate"
}

// ── TLDR generator ───────────────────────────────────────────────────────────

function buildTldr(
  input: GuidanceInput,
  stateName: string,
  hasBanTheBox: boolean,
  banTheBoxScope: string,
  lookbackYears: number | null,
  outlook: GuidanceResult["outlook"],
  industryLabels: string[]
): string {
  const { recordTypes, yearsAgo } = input

  const recordLabel =
    recordTypes.length === 1
      ? RECORD_LABELS[recordTypes[0]]
      : recordTypes.length === 2
        ? `${RECORD_LABELS[recordTypes[0]]} and ${RECORD_LABELS[recordTypes[1]]}`
        : "multiple record types"

  const timeLabel = YEARS_AGO_LABELS[yearsAgo]
  const industryText =
    industryLabels.length === 0
      ? "your target industries"
      : industryLabels.length === 1
        ? industryLabels[0]
        : `${industryLabels.slice(0, -1).join(", ")} and ${industryLabels[industryLabels.length - 1]}`

  const stateProtectionNote = hasBanTheBox
    ? banTheBoxScope === "all_employers"
      ? `${stateName} has a ban-the-box law covering all employers, meaning companies cannot ask about your ${recordLabel} until a conditional job offer is made.`
      : banTheBoxScope === "large_employers"
        ? `${stateName} has a ban-the-box law for larger employers, so many companies cannot ask about your record until late in the hiring process.`
        : `${stateName} has ban-the-box protections for government employers.`
    : `${stateName} does not have a statewide ban-the-box law, so employers can ask about your ${recordLabel} at any point in the hiring process.`

  const lookbackNote =
    lookbackYears != null
      ? ` The state's ${lookbackYears}-year lookback limit means your ${recordLabel} from ${timeLabel} ${isOldRecord(yearsAgo) && yearsAgo === "over_10" ? "falls outside the reportable window and cannot appear on most background checks" : "may still appear on checks within that window"}.`
      : ""

  const outlookNote =
    outlook === "strong"
      ? ` Overall, your prospects in ${industryText} look strong — a combination of state protections and time since the record works in your favor.`
      : outlook === "moderate"
        ? ` With the right preparation and by targeting fair chance employers, you have a reasonable path forward in ${industryText}.`
        : outlook === "challenging"
          ? ` The hiring landscape in ${industryText} will present real challenges, but there are concrete steps and specific employers that actively hire people with your background.`
          : ` Certain roles in ${industryText} have regulatory barriers that make this path genuinely difficult, but there are still viable options — particularly in roles that are not directly regulated.`

  return `${stateProtectionNote}${lookbackNote}${outlookNote}`
}

// ── State protections builder ─────────────────────────────────────────────────

function buildStateProtections(
  stateRow: {
    state_name: string
    has_ban_the_box: boolean
    ban_the_box_scope: string
    ban_the_box_law_name: string | null
    lookback_limit_years: number | null
    lookback_limit_notes: string | null
    requires_individual_assessment: boolean
    allows_expungement_nondisclosure: boolean
    expungement_notes: string | null
    credit_check_restricted: boolean
    credit_check_notes: string | null
  },
  recordTypes: RecordType[]
): ProtectionItem[] {
  const items: ProtectionItem[] = []

  // Ban the box
  if (stateRow.has_ban_the_box) {
    const scopeLabel =
      stateRow.ban_the_box_scope === "all_employers"
        ? "All employers"
        : stateRow.ban_the_box_scope === "large_employers"
          ? "Large employers"
          : "Government employers"

    items.push({
      icon: "gavel",
      title: stateRow.ban_the_box_law_name
        ? `Ban-the-box: ${stateRow.ban_the_box_law_name}`
        : "Ban-the-box protection",
      detail: `${scopeLabel} must defer criminal history inquiries until a conditional offer is made.`,
      tag: stateRow.ban_the_box_scope === "all_employers" ? "Protected" : "Partial",
      severity: stateRow.ban_the_box_scope === "all_employers" ? "protected" : "partial",
    })
  } else {
    items.push({
      icon: "warning",
      title: "No ban-the-box law",
      detail: `${stateRow.state_name} does not restrict when employers can ask about criminal history. Expect criminal history questions early in applications.`,
      tag: "Exposed",
      severity: "exposed",
    })
  }

  // Individual assessment
  if (stateRow.requires_individual_assessment) {
    items.push({
      icon: "balance",
      title: "Individualized assessment required",
      detail:
        "Employers must consider nature of crime, time elapsed, and job duties before rejecting based on criminal record. A blanket policy of excluding all applicants with records is illegal.",
      tag: "Protected",
      severity: "protected",
    })
  }

  // Lookback limit
  if (stateRow.lookback_limit_years != null) {
    items.push({
      icon: "history",
      title: `${stateRow.lookback_limit_years}-year lookback limit`,
      detail:
        stateRow.lookback_limit_notes ??
        `Background check services cannot report convictions older than ${stateRow.lookback_limit_years} years.`,
      tag: "Protected",
      severity: "protected",
    })
  } else if (recordTypes.some((r) => LOOKBACK_SENSITIVE_TYPES.includes(r))) {
    items.push({
      icon: "history_toggle_off",
      title: "No lookback limit",
      detail: `${stateRow.state_name} has no statutory limit on how far back a background check can report. Your full record may be visible to employers.`,
      tag: "Exposed",
      severity: "exposed",
    })
  }

  // Expungement
  if (stateRow.allows_expungement_nondisclosure) {
    items.push({
      icon: "auto_delete",
      title: "Expungement / nondisclosure available",
      detail:
        stateRow.expungement_notes ??
        `${stateRow.state_name} allows eligible individuals to seal or expunge certain records. Expunged records generally do not need to be disclosed to private employers.`,
      tag: "Protected",
      severity: "protected",
    })
  }

  // Credit check restriction
  if (stateRow.credit_check_restricted && recordTypes.includes("credit_issues")) {
    items.push({
      icon: "credit_score",
      title: "Credit check restrictions",
      detail:
        stateRow.credit_check_notes ??
        `${stateRow.state_name} limits when employers can run credit checks. Credit history must be directly relevant to the position.`,
      tag: "Partial",
      severity: "partial",
    })
  } else if (!stateRow.credit_check_restricted && recordTypes.includes("credit_issues")) {
    items.push({
      icon: "credit_card_off",
      title: "Credit checks unrestricted",
      detail: `${stateRow.state_name} does not restrict employer credit checks. Finance, government, and some other roles routinely run them.`,
      tag: "Exposed",
      severity: "exposed",
    })
  }

  // Non-conviction records
  if (recordTypes.includes("arrest_no_conviction") || recordTypes.includes("dismissed_charges")) {
    const federalProtection: ProtectionItem = {
      icon: "shield",
      title: "Arrests without conviction",
      detail:
        "Under the EEOC and most state laws, arrests that did not lead to conviction are not a reliable indicator of conduct and should not be used to disqualify applicants. However, enforcement varies.",
      tag: "Partial",
      severity: "partial",
    }
    items.push(federalProtection)
  }

  // Expunged record
  if (recordTypes.includes("expunged_record")) {
    items.push({
      icon: "verified_user",
      title: "Expunged record",
      detail:
        "For most private employers, you legally do not need to disclose expunged records. Federal positions, law enforcement, and some licensed professions may still ask. Confirm the specific disclosure rules in your state.",
      tag: "Protected",
      severity: "protected",
    })
  }

  return items
}

// ── Industry breakdown builder ────────────────────────────────────────────────

type IndustryDbRow = {
  industry_slug: string
  industry_label: string
  material_icon: string
  typical_lookback_years: number | null
  runs_credit_check: boolean
  fdic_applicable: boolean
  oig_applicable: boolean
  security_clearance_possible: boolean
  conviction_risk_level: "low" | "medium" | "high"
  credit_risk_level: "low" | "medium" | "high"
  gap_risk_level: "low" | "medium" | "high"
  notes: string
}

function buildIndustryBreakdown(
  industryRows: IndustryDbRow[],
  recordTypes: RecordType[],
  yearsAgo: YearsAgo
): IndustryBreakdownItem[] {
  return industryRows.map((ind) => {
    const risks: string[] = []
    let overallRisk: "low" | "medium" | "high" = "low"
    let verdict = ""

    const hasConviction = recordTypes.includes("criminal_conviction")
    const hasCreditIssues = recordTypes.includes("credit_issues")
    const hasGap = recordTypes.includes("employment_gap")
    const isRecent = isRecentRecord(yearsAgo)

    // Determine effective risk
    if (hasConviction && ind.conviction_risk_level === "high") {
      overallRisk = "high"
      if (ind.fdic_applicable) {
        risks.push("FDIC Section 19 may bar certain convictions without a waiver")
      } else if (ind.oig_applicable) {
        risks.push("OIG exclusion check required; certain convictions are disqualifying")
      } else if (ind.security_clearance_possible) {
        risks.push("Security clearance review includes full conviction history")
      } else {
        risks.push("Conviction history is closely scrutinized in this industry")
      }
    } else if (hasConviction && ind.conviction_risk_level === "medium") {
      overallRisk = "medium"
      risks.push("Some roles in this industry scrutinize conviction history more closely")
    } else if (hasConviction && ind.conviction_risk_level === "low") {
      overallRisk = "low"
      risks.push("Fair chance hiring is common; conviction history has lower impact")
    }

    if (hasCreditIssues && ind.credit_risk_level === "high") {
      if (overallRisk !== "high") overallRisk = "high"
      risks.push("Credit checks are standard; poor credit history can be disqualifying for many roles")
    } else if (hasCreditIssues && ind.runs_credit_check && ind.credit_risk_level === "medium") {
      if (overallRisk === "low") overallRisk = "medium"
      risks.push("Credit checks are run; impact depends on specific role")
    }

    if (hasGap && ind.gap_risk_level === "medium") {
      if (overallRisk === "low") overallRisk = "medium"
      risks.push("Employment gaps are reviewed but rarely disqualifying in this industry")
    }

    // Build lookback description
    const lookbackText =
      ind.typical_lookback_years != null
        ? `${ind.typical_lookback_years}-year background check`
        : "Unlimited / comprehensive background investigation"

    const checkParts = [lookbackText]
    if (ind.fdic_applicable) checkParts.push("FDIC Section 19")
    if (ind.oig_applicable) checkParts.push("OIG exclusion list")
    if (ind.security_clearance_possible) checkParts.push("possible security clearance")
    if (ind.runs_credit_check) checkParts.push("credit check")

    const checkDescription = checkParts.join(" · ")

    // Verdict text
    if (overallRisk === "low") {
      verdict = isRecent
        ? "Accessible — ban-the-box and fair chance hiring common"
        : "Very accessible — older records rarely impact hiring"
    } else if (overallRisk === "medium") {
      verdict = "Navigable — some roles will be restricted, others open"
    } else {
      verdict = ind.fdic_applicable
        ? "Restricted — FDIC waiver may be required"
        : ind.oig_applicable
          ? "Restricted — OIG check may disqualify certain convictions"
          : "Challenging — this industry has strict screening standards"
    }

    return {
      icon: ind.material_icon,
      label: ind.industry_label,
      checkDescription,
      verdict,
      severity: overallRisk,
    }
  })
}

// ── Action items builder ──────────────────────────────────────────────────────

function buildActionItems(
  input: GuidanceInput,
  stateRow: {
    allows_expungement_nondisclosure: boolean
    expungement_notes: string | null
    state_name: string
  }
): ActionItem[] {
  const items: ActionItem[] = []

  // 1. Run your own background check
  items.push({
    icon: "manage_search",
    title: "Run your own background check first",
    detail:
      "Know exactly what employers will see before they do. Use Checkr (checkr.com/candidates) or Sterling Volunteers to get a consumer-facing report of your own record. Dispute any errors before applying.",
  })

  // 2. Expungement if eligible
  if (
    stateRow.allows_expungement_nondisclosure &&
    (input.recordTypes.includes("criminal_conviction") ||
      input.recordTypes.includes("arrest_no_conviction") ||
      input.recordTypes.includes("dismissed_charges"))
  ) {
    items.push({
      icon: "auto_delete",
      title: "Check if you qualify for expungement",
      detail: `${stateRow.state_name} allows expungement for some records. ${stateRow.expungement_notes ? stateRow.expungement_notes + " " : ""}Contact a local legal aid organization or reentry nonprofit to assess your eligibility — many offer free consultations.`,
    })
  }

  // 3. Target fair chance employers
  items.push({
    icon: "handshake",
    title: "Target fair chance employers",
    detail:
      "Companies that have signed fair chance pledges or Second Chance commitments proactively hire people with records. Amazon, Target, Walmart, JPMorgan Chase, and Microsoft all have public commitments. The 'Safe Companies' tab shows you verified fair chance employers.",
  })

  // 4. Prepare your disclosure statement
  if (
    input.recordTypes.includes("criminal_conviction") ||
    input.recordTypes.includes("arrest_no_conviction")
  ) {
    items.push({
      icon: "edit_note",
      title: "Prepare your disclosure statement",
      detail:
        "If you need to disclose, write a brief, forward-looking statement that acknowledges the record, explains any context, and emphasizes what you've done since. Keep it under 3 sentences. Lead with accountability, end with capability.",
    })
  }

  // 5. Credit issues
  if (input.recordTypes.includes("credit_issues")) {
    items.push({
      icon: "credit_score",
      title: "Address credit issues proactively",
      detail:
        "For finance and government roles that run credit checks, consider getting your free credit report at AnnualCreditReport.com and disputing any errors. A brief explanation letter for major credit events (medical debt, job loss) can accompany applications at companies that allow it.",
    })
  }

  // 6. Employment gap
  if (input.recordTypes.includes("employment_gap")) {
    items.push({
      icon: "timeline",
      title: "Frame your employment gap strategically",
      detail:
        "Prepare a clear, brief explanation for your gap. Volunteering, freelance work, caregiving, or educational activity during the gap period strengthens your narrative. Many hiring managers will accept a well-framed explanation.",
    })
  }

  return items
}

// ── Main exported function ────────────────────────────────────────────────────

export async function generateGuidance(input: GuidanceInput): Promise<GuidanceResult> {
  const pool = getPostgresPool()

  const [stateResult, industryResult] = await Promise.all([
    pool.query<{
      state_name: string
      has_ban_the_box: boolean
      ban_the_box_scope: string
      ban_the_box_law_name: string | null
      lookback_limit_years: number | null
      lookback_limit_notes: string | null
      requires_individual_assessment: boolean
      allows_expungement_nondisclosure: boolean
      expungement_notes: string | null
      credit_check_restricted: boolean
      credit_check_notes: string | null
    }>(
      `SELECT state_name, has_ban_the_box, ban_the_box_scope, ban_the_box_law_name,
              lookback_limit_years, lookback_limit_notes, requires_individual_assessment,
              allows_expungement_nondisclosure, expungement_notes,
              credit_check_restricted, credit_check_notes
       FROM public.state_protections WHERE state_code = $1`,
      [input.stateCode.toUpperCase()]
    ),
    pool.query<IndustryDbRow>(
      `SELECT industry_slug, industry_label, material_icon, typical_lookback_years,
              runs_credit_check, fdic_applicable, oig_applicable,
              security_clearance_possible, conviction_risk_level, credit_risk_level,
              gap_risk_level, notes
       FROM public.industry_check_profiles
       WHERE industry_slug = ANY($1)`,
      [input.industries]
    ),
  ])

  const stateRow = stateResult.rows[0]
  const industryRows = industryResult.rows

  // Fallback if state not found
  const effectiveState = stateRow ?? {
    state_name: input.stateCode.toUpperCase(),
    has_ban_the_box: false,
    ban_the_box_scope: "none",
    ban_the_box_law_name: null,
    lookback_limit_years: null,
    lookback_limit_notes: null,
    requires_individual_assessment: false,
    allows_expungement_nondisclosure: false,
    expungement_notes: null,
    credit_check_restricted: false,
    credit_check_notes: null,
  }

  const industryRiskLevels = industryRows.map((i) => i.conviction_risk_level)
  const outlook = computeOutlook(input, effectiveState.has_ban_the_box, industryRiskLevels)

  const industryLabels = industryRows.map((i) => i.industry_label)

  const tldr = buildTldr(
    input,
    effectiveState.state_name,
    effectiveState.has_ban_the_box,
    effectiveState.ban_the_box_scope,
    effectiveState.lookback_limit_years,
    outlook,
    industryLabels
  )

  const stateProtections = buildStateProtections(effectiveState, input.recordTypes)
  const industryBreakdown = buildIndustryBreakdown(industryRows, input.recordTypes, input.yearsAgo)
  const actionItems = buildActionItems(input, effectiveState)

  return {
    outlook,
    tldr,
    stateProtections,
    industryBreakdown,
    actionItems,
    disclaimer:
      "This tool provides general awareness information only — it is not legal advice. Laws change, local ordinances may differ from state law, and individual circumstances vary. For advice specific to your situation, consult a reentry attorney or legal aid organization in your area.",
  }
}
