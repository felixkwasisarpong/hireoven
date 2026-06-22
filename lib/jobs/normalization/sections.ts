import { parseJobDescriptionSections } from "@/lib/jobs/description"
import {
  CANONICAL_SECTION_ORDER,
  classifyHeading,
  classifyTextByHeuristic,
  sectionLabel,
  uniqCaseInsensitive,
} from "@/lib/jobs/normalization/section-taxonomy"
import type {
  CanonicalSection,
  CanonicalSectionKey,
  FieldProvenance,
  SourceAdapterKind,
} from "@/lib/jobs/normalization/types"

type SectionBucket = {
  items: string[]
  confidences: number[]
  provenance: FieldProvenance[]
  isFallback: boolean
}

const REQUIREMENT_LIKE_RE =
  /\b(required|required qualifications|minimum qualifications|minimum requirements|basic qualifications|must have|must be|years of experience|experience with|bachelor|degree|proficiency|strong understanding|candidate should have|ideal candidate should have)\b/i

const PREFERRED_LIKE_RE =
  /\b(preferred qualifications|preferred|nice to have|bonus|plus|would be a plus)\b/i

const RESPONSIBILITY_LIKE_RE =
  /\b(builds?|building|designs?|designed|develops?|developing|delivers?|collaborates?|partners?|leads?|owns?|creates?|drives?|maintains?|implements?|optimizes?|supports?|performs?|validates?|documents?|manages?)\b/i

// `equity` is bare-matched but guarded against industry terms ("private equity",
// "home equity", "brand equity", "real estate equity", "venture equity") that
// otherwise leak requirement/responsibility bullets into the benefits section.
const BENEFITS_LIKE_RE =
  /\b(benefits?|perks?|total rewards?|health(?:care|[ -]?insurance)?|dental|vision|medical|401\s?\(k\)|retirement|pension|paid time off|pto|unlimited pto|parental(?: leave)?|maternity|paternity|family leave|wellness|wellbeing|stipend|bonus|(?<!(?:private|home|brand|real\s+estate|venture)\s)equity|stock(?: options?| grants?|[ -]?units?)?|rsu|vesting|profit[ -]?sharing|commuter|gym|fitness|education(?:al)?|tuition|learning|home[ -]?office|life insurance|disability|fsa|hsa|flexible|reimbursement|vacation|holiday|time off|leave|coverage)\b/i

const OFFER_CULTURE_LIKE_RE =
  /\b(fast[- ]growing|entrepreneurial(?:-minded)?|friendly and laid-back atmosphere|laid-back atmosphere|asynchronous culture|supportive work environment|opportunity to work on|opportunity to make (?:a )?big impact|shape the company and product|hands-off management approach)\b/i

const CANDIDATE_PROFILE_LIKE_RE =
  /\b(ideal candidate|candidate should have|who you are|you\s+(?:know|work|have|are|can|enjoy)\b)\b/i

const TRAIT_LEADIN_RE =
  /^[A-Z][A-Za-z/& -]{2,40}\.\s+You\s+(?:know|work|have|are|can|enjoy)\b/

const COMPANY_LIKE_RE =
  /\b(we are|we(?:'|’)re looking|we strive|at [A-Z][A-Za-z0-9&.' -]{1,48},?\s+we|our mission|our values|our culture|founded|part of|customers|global team|across [a-z]+ countries|we offer|about us)\b/i

const APPLICATION_LIKE_RE =
  /\b(apply for this role|apply now|application process|how to apply|interview process|encouraged to apply)\b/i

// Items about travel frequency, physical/office environment, or boilerplate
// legal pay-transparency qualifiers — not useful benefit or compensation facts.
const NOISE_DISCARD_RE =
  /\b(travel\s+\d|requires?\s+travel|travel\s+(?:up to|approximately|about)|\d+%\s+(?:of\s+the\s+)?time|performed\s+in\s+an\s+office|office\s+setting|sit\s+and\s+stand|standard\s+office\s+equipment|incumbent|physical(?:\s+requirements?)?|mental\/physical|motor\s+skills|lift(?:ing)?\s+\d|sedentary|noise\s+level|varies?\s+(?:upon|depending\s+on)\s+the\s+needs\s+of\s+the\s+department|may\s+vary\s+depending\s+on\s+job[- ]related\s+factors)\b/i

const EQUAL_OPPORTUNITY_LIKE_RE =
  /\b(equal opportunity|eeo|reasonable accommodation|accommodation|protected veteran|affirmative action|diverse workforce|diversity and inclusion)\b/i

const LOCATION_META_LIKE_RE =
  /\b(office locations?|office-assigned|job type|work model|on-site|onsite|hybrid|remote|location[s]?)\b/i

const PROMOTIONAL_LIKE_RE =
  /\b(career advancement|grow your skills|grow and develop|personal development plans|join [a-z][a-z ]+ and do work that matters|stand out|set you apart|extraordinary twists and turns|welcome diverse perspectives|challenge assumptions|make a difference|be part of something|impact millions)\b/i

const SKILLS_HEADING_NOISE_RE =
  /^(?:about(?:\s+(?:the|this))?\s+role|role overview|overview|the\s+(?:position|role|opportunity)|job summary|position summary|responsibilities|position responsibilities|key responsibilities|what you(?:'|’)ll do|what you will do|requirements|minimum requirements|minimum qualifications|basic qualifications|required qualifications|qualifications required|preferred qualifications|qualifications|benefits|perks|company|about us|about the company)$/i

const COMPENSATION_LIKE_RE =
  /\b(\$\s?\d|usd|salary|pay range|base salary|on target earnings|annual(?:ly)?|per year|ote)\b/i

const NON_SUBSTANTIVE_REQUIREMENT_RE =
  /\b(meets? the minimum requirements|encouraged to apply|not a requirement|requirements are still being parsed)\b/i

const VISA_LIKE_RE =
  /\b(visa|sponsors?|sponsorship|work authorization|authorized to work|employment authorization|h-?1b|h1b|opt|stem opt|work permit|right to work|citizenship|u\.s\. person|export control|security clearance)\b/i

const WORKDAY_FOOTER_META_RE =
  /\b(contingent upon award|program award|shift\s*\d?|not applicable|language requirements?|relocation|safety sensitive|drug free workplace|codevue|coding challenge|stay safe from recruitment fraud|recruitment fraud|applicant privacy|request an accommodation|right to work statement|right to work \((?:english|spanish)\)|participates in e\s*[-–]?\s*verify|e\s*[-–]?\s*verify)(?:\b|$)/i

const COMPANY_POSITIONING_RE =
  /\b(platform|mission|industry|customers|community|financial services|value out of|across europe)\b/i

const ABOUT_BLOCKED_RE =
  /\b(what you(?:'|’)ll do|what you will do|responsibilit|minimum qualifications|basic qualifications|required qualifications|preferred qualifications|requirements|benefits|compensation|application process)\b/i

const SECTION_MARKER_RE =
  /\b(minimum qualifications|minimum requirements|basic qualifications|required qualifications|preferred qualifications|responsibilities|benefits|compensation)\b/i

// Lines that are definitively navigation / UI chrome surviving HTML parsing.
// Matched case-insensitively on the trimmed item string.
const UI_CHROME_RE =
  /^(sign in|sign up|log in|log out|login|apply now|apply|save( this)? job|share( this)? job|skip to|related jobs?|similar jobs?|back to (search|results|jobs)|cookie|privacy policy|terms of (service|use)|create (a )?job alert|get notified|easy apply|promoted|be an early applicant|\d+ applicants?|menu|home|search jobs?|find jobs?|view all (jobs?|openings?)|read more|see more|learn more|accessibility)$/i

// Phrases that, when present anywhere in an item, indicate the item is chrome
// rather than substantive job content. Used to drop full items whose body
// contains UI/auth/nav strings even if the item also has surrounding text.
const CHROME_SUBSTRING_RE =
  /\b(skip to (main )?content|sign in to (save|create|get|set up)|create (a |an )?job alert|get notified about (similar|new) jobs|cookie (policy|notice|preferences|settings|banner)|privacy (policy|notice)|terms of (service|use)|back to (search|results|jobs)|related jobs?|similar jobs?|recommended jobs?|you may also like|easy apply|be an early applicant)\b/i

type InlineHeadingAlias = {
  key: CanonicalSectionKey
  alias: string
}

type InlineHeadingMatch = InlineHeadingAlias & {
  index: number
}

const INLINE_SECTION_ALIASES: InlineHeadingAlias[] = [
  { key: "about_role", alias: "About the role" },
  { key: "about_role", alias: "About this role" },
  { key: "about_role", alias: "Role overview" },
  { key: "about_role", alias: "Overview" },
  { key: "about_role", alias: "About the team" },
  { key: "responsibilities", alias: "Responsibilities" },
  { key: "responsibilities", alias: "Position responsibilities" },
  { key: "responsibilities", alias: "Key responsibilities" },
  { key: "responsibilities", alias: "What you'll do" },
  { key: "responsibilities", alias: "What you will do" },
  { key: "requirements", alias: "Requirements" },
  { key: "requirements", alias: "Minimum requirements" },
  { key: "requirements", alias: "Minimum qualifications" },
  { key: "requirements", alias: "Basic qualifications" },
  { key: "requirements", alias: "Required qualifications" },
  { key: "requirements", alias: "Qualifications required" },
  { key: "requirements", alias: "Who you are" },
  { key: "requirements", alias: "Qualifications" },
  { key: "requirements", alias: "What you bring" },
  { key: "requirements", alias: "Ideal candidate should have" },
  { key: "requirements", alias: "An ideal candidate should have" },
  { key: "preferred_qualifications", alias: "Preferred qualifications" },
  { key: "preferred_qualifications", alias: "Additional qualifications" },
  { key: "preferred_qualifications", alias: "Nice to have" },
  { key: "skills", alias: "Skills" },
  { key: "skills", alias: "Technical skills" },
  { key: "skills", alias: "Key skills" },
  { key: "skills", alias: "Technologies" },
  { key: "benefits", alias: "Benefits" },
  { key: "benefits", alias: "Perks" },
  { key: "benefits", alias: "What we offer" },
  { key: "benefits", alias: "Additional benefits" },
  { key: "company_info", alias: "Who we are" },
  { key: "company_info", alias: "About us" },
  { key: "equal_opportunity", alias: "Equal opportunity" },
  { key: "equal_opportunity", alias: "EEO" },
  { key: "application_info", alias: "How to apply" },
  { key: "application_info", alias: "Application process" },
  { key: "application_info", alias: "Apply for this role" },
  { key: "application_info", alias: "Office locations" },
  { key: "application_info", alias: "Job type" },
  { key: "requirements", alias: "Security Clearance" },
  { key: "requirements", alias: "Export Control Requirement" },
  { key: "other", alias: "Language Requirements" },
  { key: "other", alias: "Education" },
  { key: "other", alias: "Relocation" },
  { key: "other", alias: "Safety Sensitive" },
  { key: "other", alias: "Drug Free Workplace" },
  { key: "other", alias: "CodeVue Coding Challenge" },
  { key: "other", alias: "Contingent Upon Award Program" },
  { key: "other", alias: "Shift" },
  // Expanded aliases for common real-world heading variations
  { key: "about_role", alias: "The opportunity" },
  { key: "about_role", alias: "The position" },
  { key: "about_role", alias: "Your role" },
  { key: "about_role", alias: "The role" },
  { key: "about_role", alias: "Job summary" },
  { key: "about_role", alias: "Position summary" },
  { key: "responsibilities", alias: "Key responsibilities" },
  { key: "responsibilities", alias: "In this role" },
  { key: "responsibilities", alias: "What you'll be doing" },
  { key: "responsibilities", alias: "How you'll make an impact" },
  { key: "responsibilities", alias: "How you'll spend your time" },
  { key: "responsibilities", alias: "Your impact" },
  { key: "requirements", alias: "What we're looking for" },
  { key: "requirements", alias: "What you'll need" },
  { key: "requirements", alias: "Required experience" },
  { key: "requirements", alias: "Required skills" },
  { key: "requirements", alias: "Must have" },
  { key: "requirements", alias: "Must-have" },
  { key: "requirements", alias: "Your qualifications" },
  { key: "preferred_qualifications", alias: "Nice-to-have" },
  { key: "preferred_qualifications", alias: "Bonus qualifications" },
  { key: "preferred_qualifications", alias: "Good to have" },
  { key: "preferred_qualifications", alias: "Would be a plus" },
  { key: "skills", alias: "Tech stack" },
  { key: "skills", alias: "Tools" },
  { key: "skills", alias: "Core skills" },
  { key: "skills", alias: "Technical requirements" },
  { key: "benefits", alias: "Why join us" },
  { key: "benefits", alias: "Why work here" },
  { key: "benefits", alias: "Our benefits" },
  { key: "benefits", alias: "The perks" },
  { key: "benefits", alias: "Life at" },
  { key: "benefits", alias: "Total rewards" },
  { key: "benefits", alias: "What you'll get" },
  { key: "benefits", alias: "What you get" },
  { key: "benefits", alias: "What we provide" },
  { key: "benefits", alias: "What's in it for you" },
  { key: "benefits", alias: "Your benefits" },
  { key: "benefits", alias: "Perks & benefits" },
  { key: "benefits", alias: "Benefits & perks" },
  { key: "benefits", alias: "Employee benefits" },
  { key: "benefits", alias: "Benefits package" },
  { key: "benefits", alias: "We offer" },
  { key: "benefits", alias: "What you'll receive" },
  { key: "compensation", alias: "Salary" },
  { key: "compensation", alias: "Pay range" },
  { key: "compensation", alias: "Pay" },
  { key: "compensation", alias: "Salary range" },
  { key: "compensation", alias: "Total compensation" },
  { key: "compensation", alias: "Compensation range" },
  { key: "compensation", alias: "Compensation & benefits" },
  { key: "compensation", alias: "Base salary" },
  { key: "compensation", alias: "Base pay" },
  { key: "compensation", alias: "Annual salary" },
  { key: "compensation", alias: "On-target earnings" },
  { key: "compensation", alias: "Compensation details" },
  { key: "company_info", alias: "About the company" },
  { key: "company_info", alias: "About the team" },
  { key: "company_info", alias: "Our mission" },
  { key: "company_info", alias: "Our story" },
  { key: "company_info", alias: "What we do" },
  { key: "company_info", alias: "The team" },
  { key: "equal_opportunity", alias: "Diversity and inclusion" },
  { key: "equal_opportunity", alias: "Equal employment opportunity" },
  { key: "application_info", alias: "Interview process" },
  { key: "application_info", alias: "Next steps" },
  { key: "application_info", alias: "The process" },
  { key: "application_info", alias: "Recruitment process" },
  // Regional salary-disclosure blocks (e.g. Visa Inc., California law)
  { key: "compensation", alias: "U.S. Applicants Only" },
  { key: "compensation", alias: "US Applicants Only" },
  { key: "compensation", alias: "For U.S. Applicants" },
  { key: "compensation", alias: "For US Based Applicants" },
  { key: "compensation", alias: "Salary Information" },
  { key: "compensation", alias: "Pay transparency" },
  { key: "compensation", alias: "Pay Transparency" },
  // Physical/travel sections → route to other so they don't pollute comp/benefits
  { key: "other", alias: "Travel Requirements" },
  { key: "other", alias: "Travel" },
  { key: "other", alias: "Physical Requirements" },
  { key: "other", alias: "Mental/Physical Requirements" },
  { key: "other", alias: "Work Environment" },
  { key: "other", alias: "Work Conditions" },
  { key: "other", alias: "Physical Demands" },
  { key: "other", alias: "Working Conditions" },
  { key: "other", alias: "Additional Information" },
  { key: "visa", alias: "Work authorization" },
  { key: "visa", alias: "Work eligibility" },
  { key: "visa", alias: "Employment eligibility" },
  { key: "visa", alias: "Authorization" },
  { key: "visa", alias: "Work permit" },
  { key: "visa", alias: "Visa sponsorship" },
  { key: "visa", alias: "Visa requirements" },
  { key: "visa", alias: "H-1B sponsorship" },
  { key: "visa", alias: "H1B" },
  { key: "visa", alias: "Immigration" },
  { key: "visa", alias: "Sponsorship" },
  { key: "visa", alias: "Legally authorized" },
]

function createEmptyBuckets(): Record<CanonicalSectionKey, SectionBucket> {
  return {
    header: { items: [], confidences: [], provenance: [], isFallback: false },
    compensation: { items: [], confidences: [], provenance: [], isFallback: false },
    visa: { items: [], confidences: [], provenance: [], isFallback: false },
    about_role: { items: [], confidences: [], provenance: [], isFallback: false },
    responsibilities: { items: [], confidences: [], provenance: [], isFallback: false },
    requirements: { items: [], confidences: [], provenance: [], isFallback: false },
    qualifications: { items: [], confidences: [], provenance: [], isFallback: false },
    preferred_qualifications: {
      items: [],
      confidences: [],
      provenance: [],
      isFallback: false,
    },
    skills: { items: [], confidences: [], provenance: [], isFallback: false },
    benefits: { items: [], confidences: [], provenance: [], isFallback: false },
    company_info: { items: [], confidences: [], provenance: [], isFallback: false },
    equal_opportunity: { items: [], confidences: [], provenance: [], isFallback: false },
    application_info: { items: [], confidences: [], provenance: [], isFallback: false },
    other: { items: [], confidences: [], provenance: [], isFallback: false },
  }
}

// Leading list-marker glyphs that often survive HTML→text extraction. Includes
// U+2022 BULLET, U+25CF BLACK CIRCLE (most common), U+25E6, U+25AA, U+25AB,
// U+2023, U+2043, U+2219, U+00B7 MIDDLE DOT, plus the ASCII -, *, NBSP.
const LEADING_BULLET_RE =
  /^(?:[•●◦▪▫‣⁃∙·⁌⁍‧․\-*]|\s| )+/

const HEADING_MARKER_ITEM_RE =
  /^[A-Z][A-Z\s,&/()'-]{2,}:?$/

function stripBulletPrefix(value: string): string {
  // Only strip leading run if it ends with whitespace-or-bullet — guards
  // against accidentally eating a real "-3 years experience" lead-in.
  return value.replace(LEADING_BULLET_RE, "").trim()
}

function stripSectionLeadIn(value: string): string {
  return value
    .replace(/\bYo\s+u(?:'|’)ll\b/gi, "You'll")
    .replace(/\b([A-Za-z]+)\s+(?:'|’)\s*(ll|re|ve|d|m|s|t)\b/gi, "$1'$2")
    .replace(/^(what you(?:'|’)ll do|what you will do)\b[:\s-]*/i, "")
    .replace(/^(an\s+)?ideal candidate should have\b[:\s-]*/i, "")
    .replace(/^(position responsibilities|key responsibilities|responsibilities)\b[:\s-]*/i, "")
    .trim()
}

function addItems(
  bucket: SectionBucket,
  items: string[],
  confidence: number,
  provenance: FieldProvenance,
  maxItems = 30
) {
  if (items.length === 0) return

  const trimmed = items
    .map((item) =>
      stripSectionLeadIn(
        stripBulletPrefix(
          item
            .replace(/[–—]/g, "-")
            .replace(/\s+/g, " ")
            .trim()
        )
      )
    )
    .filter(
      (item) =>
        item.length >= 3 &&
        !UI_CHROME_RE.test(item) &&
        !CHROME_SUBSTRING_RE.test(item) &&
        // Drop residual heading markers like "PREFERRED KNOWLEDGE, SKILLS, AND ABILITIES:"
        !HEADING_MARKER_ITEM_RE.test(item)
    )

  const unique = uniqCaseInsensitive([...bucket.items, ...trimmed], maxItems)
  const addedCount = Math.max(0, unique.length - bucket.items.length)

  bucket.items = unique
  for (let i = 0; i < addedCount; i += 1) {
    bucket.confidences.push(confidence)
  }
  if (addedCount > 0) {
    bucket.provenance.push(provenance)
  }
}

function sectionConfidence(bucket: SectionBucket): number {
  if (bucket.items.length === 0) return 0
  if (bucket.confidences.length === 0) return bucket.isFallback ? 0.42 : 0.6
  const total = bucket.confidences.reduce((sum, value) => sum + value, 0)
  return Math.max(0.1, Math.min(1, total / bucket.confidences.length))
}

function splitParagraphIntoBullets(paragraph: string): string[] {
  return splitIntoSentences(paragraph)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12)
}

const SENTENCE_DOT_TOKEN = "__HIREOVEN_SENTENCE_DOT__"

function protectSentenceAbbreviations(value: string): string {
  return value.replace(/\b(?:[A-Za-z]\.){2,}/g, (match) =>
    match.replace(/\./g, SENTENCE_DOT_TOKEN)
  )
}

function splitIntoSentences(text: string): string[] {
  return protectSentenceAbbreviations(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((sentence) => sentence.replaceAll(SENTENCE_DOT_TOKEN, ".").trim())
    .filter(Boolean)
}

function flattenSectionContent(section: { bullets: string[]; paragraphs: string[] }): string[] {
  const bulletItems = section.bullets
    .map((item) => item.trim())
    .filter(Boolean)

  if (bulletItems.length > 0) return bulletItems

  return section.paragraphs
    .flatMap((paragraph) => splitParagraphIntoBullets(paragraph))
    .filter(Boolean)
}

const EXPLICIT_HEADING_PATTERN =
  /(about the role|about the team|role overview|job summary|what you(?:’|’)ll do|what you will do|responsibilities|preferred qualifications|minimum qualifications|minimum requirements|required qualifications|basic qualifications|qualifications|requirements|nice to have|technical skills|key skills|skills|technologies|benefits|perks|total rewards|what you(?:’|’)ll get|what we provide|employee benefits|benefits? package|compensation|compensation range|compensation details|compensation & benefits|base salary|base pay|pay range|salary range|on-target earnings|u\.?s\.? applicants? only|for u\.?s\.? (?:based )?applicants?|salary information|pay transparency|travel requirements?|physical requirements?|mental\/physical requirements?|work environment|work conditions?|physical demands?|working conditions?|additional information|about us|about the company|who we are|company|equal opportunity|eeo|application process|how to apply|work authorization|work eligibility|employment eligibility|visa sponsorship|visa requirements|h-?1b(?: sponsorship)?|immigration|sponsorship|legally authorized)(?:\s*\([^)\n]{1,100}\))?\s*:/gi

function extractExplicitHeadingSegments(description: string): Array<{ heading: string; body: string }> {
  const matches = [...description.matchAll(EXPLICIT_HEADING_PATTERN)]
  if (matches.length === 0) return []

  const out: Array<{ heading: string; body: string }> = []
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    const next = matches[i + 1]
    const heading = current[1]?.trim()
    if (!heading) continue

    const start = (current.index ?? 0) + current[0].length
    const end = next?.index ?? description.length
    const body = description.slice(start, end).trim()
    if (!body) continue

    out.push({ heading, body })
  }

  return out
}

function itemsFromTextBlock(text: string): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const bullets: string[] = []
  for (const line of lines) {
    if (/^[-*•]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*•]\s+/, "").trim())
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      bullets.push(line.replace(/^\d+\.\s+/, "").trim())
      continue
    }
    bullets.push(...splitParagraphIntoBullets(line))
  }

  return uniqCaseInsensitive(bullets)
}

function fallbackFromFirstParagraphs(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  description: string,
  adapter: SourceAdapterKind
) {
  if (buckets.about_role.items.length > 0) return

  const paragraphs = description
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20)

  const fallbackItems = paragraphs
    .slice(0, 4)
    .flatMap((paragraph) => splitIntoSentences(paragraph))
    .map((line) => line.trim())
    .filter((line) => line.length >= 40 && line.length <= 240)
    .filter((line) => !ABOUT_BLOCKED_RE.test(line))
    .filter((line) => !RESPONSIBILITY_LIKE_RE.test(line))
    .filter((line) => !REQUIREMENT_LIKE_RE.test(line))
    .filter((line) => !PREFERRED_LIKE_RE.test(line))
    .filter((line) => !COMPANY_LIKE_RE.test(line))
    .filter((line) => !COMPANY_POSITIONING_RE.test(line))
    .filter((line) => !PROMOTIONAL_LIKE_RE.test(line))
    .slice(0, 3)

  if (fallbackItems.length === 0) return

  addItems(
    buckets.about_role,
    fallbackItems,
    0.46,
    {
      adapter,
      method: "fallback",
      source_path: "description",
    },
    6
  )
  buckets.about_role.isFallback = true
}

function fallbackResponsibilities(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.responsibilities.items.length > 0) return
  if (buckets.other.items.length === 0) return

  const candidates = buckets.other.items.filter((item) =>
    /\b(build|design|develop|collaborate|lead|deliver|create|drive|partner)\b/i.test(item)
  )

  if (candidates.length === 0) return

  addItems(
    buckets.responsibilities,
    candidates.slice(0, 8),
    0.44,
    {
      adapter,
      method: "fallback",
      source_path: "other",
    },
    12
  )
  buckets.responsibilities.isFallback = true
}

function fallbackRequirements(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.requirements.items.length > 0) return

  const sourceKeys: CanonicalSectionKey[] = ["other", "responsibilities"]

  const fromMixedSections = sourceKeys.flatMap((key) =>
    buckets[key].items.filter((item) =>
      REQUIREMENT_LIKE_RE.test(item) &&
      item.length <= 260 &&
      splitIntoSentences(item).length <= 3 &&
      !BENEFITS_LIKE_RE.test(item) &&
      !COMPANY_LIKE_RE.test(item) &&
      !APPLICATION_LIKE_RE.test(item) &&
      !LOCATION_META_LIKE_RE.test(item) &&
      !COMPENSATION_LIKE_RE.test(item)
    )
  )

  if (fromMixedSections.length === 0) return

  addItems(
    buckets.requirements,
    fromMixedSections.slice(0, 10),
    0.44,
    {
      adapter,
      method: "fallback",
      source_path: "mixed_sections",
    },
    14
  )
  buckets.requirements.isFallback = true
}

function enrichFromMixedText(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const sourceKeys: CanonicalSectionKey[] = ["about_role", "other"]

  for (const sourceKey of sourceKeys) {
    for (const item of buckets[sourceKey].items) {
      const candidates =
        item.length > 260 || SECTION_MARKER_RE.test(item)
          ? splitIntoSentences(item)
          : [item]

      for (const candidateRaw of candidates) {
        const candidate = candidateRaw.trim()
        if (candidate.length < 24 || candidate.length > 240) continue
        if (SECTION_MARKER_RE.test(candidate) && splitIntoSentences(candidate).length > 1) continue

        const classification = classifyTextByHeuristic(candidate)
        if (classification.key === "other" || classification.key === sourceKey) continue

        addItems(
          buckets[classification.key],
          [candidate],
          0.58,
          {
            adapter,
            method: "heuristic",
            source_path: `${sourceKey}.mixed`,
            source_excerpt: candidate.slice(0, 240),
          },
          14
        )
      }
    }
  }
}

function normalizeForCompare(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const INLINE_ALIAS_BOUNDARY_PATTERN = INLINE_SECTION_ALIASES
  .map((alias) => escapeRegExp(alias.alias))
  .sort((left, right) => right.length - left.length)
  .join("|")

const GLUED_INLINE_HEADING_RE = new RegExp(
  `\\b(${INLINE_ALIAS_BOUNDARY_PATTERN})(${INLINE_ALIAS_BOUNDARY_PATTERN})\\b`,
  "gi"
)

function normalizeGluedInlineHeadings(description: string): string {
  let current = description

  for (let i = 0; i < 4; i += 1) {
    const next = current.replace(GLUED_INLINE_HEADING_RE, "$1\n$2")
    if (next === current) break
    current = next
  }

  return current
}

function findInlineHeadingMatches(description: string): InlineHeadingMatch[] {
  const lower = description.toLowerCase()
  const matches: InlineHeadingMatch[] = []

  for (const alias of INLINE_SECTION_ALIASES) {
    const target = alias.alias.toLowerCase()
    let cursor = 0

    while (cursor < lower.length) {
      const index = lower.indexOf(target, cursor)
      if (index < 0) break

      let beforeNonWhitespace = ""
      let crossedNewline = false
      for (let i = index - 1; i >= 0; i -= 1) {
        const char = description[i]
        if (char === "\n" || char === "\r") { crossedNewline = true; break }
        if (char === " " || char === "\t") continue
        beforeNonWhitespace = char
        break
      }
      const after = description[index + target.length] ?? ""
      const nextNonWhitespace = (() => {
        for (let i = index + target.length; i < description.length; i += 1) {
          const char = description[i]
          if (char === " " || char === "\t") continue
          return char
        }
        return ""
      })()
      const singleWordAlias = !/\s/.test(alias.alias.trim())

      const hasStartBoundary =
        index === 0 ||
        crossedNewline ||
        beforeNonWhitespace === "" ||
        beforeNonWhitespace === "." ||
        beforeNonWhitespace === "!" ||
        beforeNonWhitespace === "?" ||
        beforeNonWhitespace === ":"

      const hasWhitespaceHeadingSignal =
        (after === " " || after === "\t") &&
        !singleWordAlias &&
        /[A-Z0-9]/.test(nextNonWhitespace)

      const hasEndSignal =
        !after ||
        after === ":" ||
        after === "-" ||
        after === "\n" ||
        after === "\r" ||
        hasWhitespaceHeadingSignal

      if (hasStartBoundary && hasEndSignal) {
        matches.push({ ...alias, index })
      }

      cursor = index + target.length
    }
  }

  const byIndex = new Map<number, InlineHeadingMatch>()
  for (const match of matches.sort((left, right) => {
    if (left.index !== right.index) return left.index - right.index
    return right.alias.length - left.alias.length
  })) {
    if (!byIndex.has(match.index)) {
      byIndex.set(match.index, match)
    }
  }

  return [...byIndex.values()].sort((left, right) => left.index - right.index)
}

function extractInlineHeadingSegments(description: string): Array<{
  key: CanonicalSectionKey
  heading: string
  body: string
}> {
  const matches = findInlineHeadingMatches(description)
  if (matches.length === 0) return []

  const out: Array<{ key: CanonicalSectionKey; heading: string; body: string }> = []

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    const next = matches[i + 1]
    const escapedAlias = escapeRegExp(current.alias)
    const leadPattern = new RegExp(`^${escapedAlias}\\s*[:\\-]?\\s*`, "i")

    const start = current.index
    const end = next?.index ?? description.length
    const rawSegment = description.slice(start, end).trim()
    const body = rawSegment.replace(leadPattern, "").trim()
    if (!body || body.length < 8) continue

    out.push({
      key: current.key,
      heading: current.alias,
      body,
    })
  }

  return out
}

function splitApplicationInfoFragments(value: string): string[] {
  const withMarkers = value
    .replace(
      /\b(Office locations?|Job type|Apply for this role|Application process|How to apply|Equal opportunity|Contingent Upon Award Program|Shift|Stay safe from recruitment fraud)\b/gi,
      "\n$1"
    )
    .replace(/\s+(At [A-Z][A-Za-z0-9&.' -]{1,48},?\s+we(?:'|’)re)\b/g, "\n$1")
    .replace(/\s+(Team)\s+(?=[A-Z])/g, "\n$1 ")

  return withMarkers
    .split(/\n+/)
    .flatMap((item) => splitIntoSentences(item))
    .map((item) => item.trim())
    .filter((item) => item.length >= 12 && item.length <= 220)
}

function looksLikeRequirementItem(value: string): boolean {
  if (NON_SUBSTANTIVE_REQUIREMENT_RE.test(value)) return false
  if (UI_CHROME_RE.test(value)) return false
  if (APPLICATION_LIKE_RE.test(value) || LOCATION_META_LIKE_RE.test(value)) return false
  if (COMPENSATION_LIKE_RE.test(value) || BENEFITS_LIKE_RE.test(value)) return false

  const candidateProfileVoice =
    TRAIT_LEADIN_RE.test(value) ||
    CANDIDATE_PROFILE_LIKE_RE.test(value)
  const explicitResponsibilityVoice =
    /\byou\s+(?:'ll|’ll|will)\b/i.test(value) ||
    /\byou\s+are\s+responsible\b/i.test(value)
  if (candidateProfileVoice && !explicitResponsibilityVoice) return true

  if (REQUIREMENT_LIKE_RE.test(value)) return true
  if (/\b\d+\+?\s+years?\b/i.test(value)) return true
  if (/\b(experience in|experience with|proven|ability to|track record|expertise|knowledge of)\b/i.test(value)) {
    return true
  }
  if (/^(?:experience|familiarity|comfort|proficiency|knowledge|expertise)\b/i.test(value)) {
    return true
  }
  if (/\bexperience\b/i.test(value) && /\b(ai|ml|llm|python|engineering|development|systems?|production)\b/i.test(value)) {
    return true
  }
  return false
}

function uniqNearDuplicate(values: string[], max = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const normalized = normalizeForCompare(value)
    if (!normalized) continue

    if (
      out.some((existing) => {
        const current = normalizeForCompare(existing)
        return current === normalized || current.includes(normalized) || normalized.includes(current)
      })
    ) {
      continue
    }
    out.push(value)
    if (out.length >= max) break
  }

  return out
}

function moveItem(
  from: SectionBucket,
  to: SectionBucket,
  item: string,
  confidence: number,
  provenance: FieldProvenance
) {
  from.items = from.items.filter((entry) => entry !== item)
  addItems(to, [item], confidence, provenance, 20)
}

function rebalanceQualificationBuckets(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const movedFromResponsibilities = [...buckets.responsibilities.items]
  for (const item of movedFromResponsibilities) {
    if (COMPENSATION_LIKE_RE.test(item)) {
      moveItem(
        buckets.responsibilities,
        buckets.compensation,
        item,
        0.66,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
      continue
    }

    if (BENEFITS_LIKE_RE.test(item) || OFFER_CULTURE_LIKE_RE.test(item)) {
      moveItem(
        buckets.responsibilities,
        buckets.benefits,
        item,
        0.66,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
      continue
    }

    const candidateProfileVoice =
      TRAIT_LEADIN_RE.test(item) ||
      CANDIDATE_PROFILE_LIKE_RE.test(item)
    const explicitResponsibilityVoice =
      /\byou\s+(?:'ll|’ll|will)\b/i.test(item) ||
      /\byou\s+are\s+responsible\b/i.test(item)
    if (candidateProfileVoice && !explicitResponsibilityVoice) {
      moveItem(
        buckets.responsibilities,
        buckets.requirements,
        item,
        0.62,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
      continue
    }

    if (PREFERRED_LIKE_RE.test(item)) {
      moveItem(
        buckets.responsibilities,
        buckets.preferred_qualifications,
        item,
        0.62,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
      continue
    }

    if (
      REQUIREMENT_LIKE_RE.test(item) &&
      !BENEFITS_LIKE_RE.test(item)
    ) {
      moveItem(
        buckets.responsibilities,
        buckets.requirements,
        item,
        0.6,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
    }
  }

  const movedFromRequirements = [...buckets.requirements.items]
  for (const item of movedFromRequirements) {
    if (!PREFERRED_LIKE_RE.test(item)) continue
    moveItem(
      buckets.requirements,
      buckets.preferred_qualifications,
      item,
      0.66,
      {
        adapter,
        method: "heuristic",
        source_path: "requirements.rebalanced",
        source_excerpt: item.slice(0, 220),
      }
    )
  }
}

function cleanQualificationLeadIn(value: string): string {
  return value
    .replace(/^job description\s*[:\-]?\s*/i, "")
    .replace(/^\((?:required|desired)\s+skills\/\s*experience\):?\s*/i, "")
    .replace(/^minimum requirements?\b[:\s-]*/i, "")
    .replace(/^(minimum|basic|required|preferred)\s+qualifications?\b[:\s-]*/i, "")
    .replace(/^qualifications?\b[:\s-]*/i, "")
    .trim()
}

const QUALIFICATION_BULLET_SEPARATOR_RE =
  /\s+-\s+(?=(?:\d+\+?\s+years?|bachelor|master|phd|experience|ability|must|required|minimum|proficiency|strong|knowledge)\b)/gi

function splitQualificationItem(item: string): string[] {
  const withMarkers = item
    .replace(
      /\s+(minimum qualifications|minimum requirements|basic qualifications|required qualifications|preferred qualifications)\s*:/gi,
      ". $1: "
    )
    .replace(QUALIFICATION_BULLET_SEPARATOR_RE, ". ")

  const parts = withMarkers
    .split(/\s*[;•]\s+/g)
    .flatMap((piece) => splitIntoSentences(piece))
    .map((piece) => cleanQualificationLeadIn(piece))
    .filter((piece) => piece.length >= 16 && piece.length <= 220)

  if (parts.length > 0) return parts

  return item
    .split(QUALIFICATION_BULLET_SEPARATOR_RE)
    .map((piece) => cleanQualificationLeadIn(piece))
    .filter((piece) => piece.length >= 16 && piece.length <= 220)
}

function sanitizeQualificationBuckets(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const nextRequirements: string[] = []
  const nextPreferred: string[] = []

  for (const item of buckets.requirements.items) {
    for (const piece of splitQualificationItem(item)) {
      if (BENEFITS_LIKE_RE.test(piece) || COMPANY_LIKE_RE.test(piece)) continue
      if (APPLICATION_LIKE_RE.test(piece) || LOCATION_META_LIKE_RE.test(piece)) continue
      if (COMPENSATION_LIKE_RE.test(piece)) continue
      if (PROMOTIONAL_LIKE_RE.test(piece)) continue

      if (PREFERRED_LIKE_RE.test(piece)) {
        nextPreferred.push(cleanQualificationLeadIn(piece))
        continue
      }

      const cleaned = cleanQualificationLeadIn(piece)
      if (!RESPONSIBILITY_LIKE_RE.test(cleaned) && looksLikeRequirementItem(cleaned)) {
        nextRequirements.push(cleaned)
      } else if (REQUIREMENT_LIKE_RE.test(cleaned) && looksLikeRequirementItem(cleaned)) {
        nextRequirements.push(cleaned)
      }
    }
  }

  for (const item of buckets.preferred_qualifications.items) {
    for (const piece of splitQualificationItem(item)) {
      if (BENEFITS_LIKE_RE.test(piece) || COMPANY_LIKE_RE.test(piece)) continue
      if (APPLICATION_LIKE_RE.test(piece) || LOCATION_META_LIKE_RE.test(piece)) continue
      if (COMPENSATION_LIKE_RE.test(piece)) continue
      if (PROMOTIONAL_LIKE_RE.test(piece)) continue

      if (!REQUIREMENT_LIKE_RE.test(piece) && RESPONSIBILITY_LIKE_RE.test(piece)) continue
      if (NON_SUBSTANTIVE_REQUIREMENT_RE.test(piece)) continue
      nextPreferred.push(cleanQualificationLeadIn(piece))
    }
  }

  const refinedRequirements = uniqCaseInsensitive(
    nextRequirements.filter(
      (item) => item.length >= 16 && looksLikeRequirementItem(item) && !NON_SUBSTANTIVE_REQUIREMENT_RE.test(item)
    ),
    12
  )
  const refinedPreferred = uniqCaseInsensitive(
    nextPreferred.filter((item) => item.length >= 16),
    10
  )

  buckets.requirements.items = refinedRequirements
  if (refinedRequirements.length > 0) {
    buckets.requirements.provenance.push({
      adapter,
      method: "heuristic",
      source_path: "requirements.sanitized",
    })
  }

  if (refinedPreferred.length > 0) {
    buckets.preferred_qualifications.items = refinedPreferred
    buckets.preferred_qualifications.provenance.push({
      adapter,
      method: "heuristic",
      source_path: "preferred_qualifications.sanitized",
    })
    return
  }

  buckets.preferred_qualifications.items = []
}

function sanitizeResponsibilitiesBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const kept: string[] = []

  for (const item of buckets.responsibilities.items) {
    const candidates = item.length > 260 ? splitIntoSentences(item) : [item]
    for (const candidateRaw of candidates) {
      const candidate = candidateRaw.trim()
      if (candidate.length < 16 || candidate.length > 420) continue
      if (/\b(including|includes?|such as|as follows|the following):?$/i.test(candidate)) continue

      if (/^about the team\b/i.test(candidate)) {
        const trimmed = candidate.replace(/^about the team\b[:\s-]*/i, "").trim()
        if (trimmed.length >= 20) {
          addItems(
            buckets.about_role,
            [trimmed],
            0.62,
            {
              adapter,
              method: "heuristic",
              source_path: "responsibilities.sanitized",
              source_excerpt: trimmed.slice(0, 200),
            },
            8
          )
        }
        continue
      }

      if (EQUAL_OPPORTUNITY_LIKE_RE.test(candidate)) {
        addItems(
          buckets.equal_opportunity,
          [candidate],
          0.7,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: candidate.slice(0, 200),
          },
          10
        )
        continue
      }

      if (APPLICATION_LIKE_RE.test(candidate) || LOCATION_META_LIKE_RE.test(candidate)) {
        const fragments = splitApplicationInfoFragments(candidate)
        for (const fragment of fragments.length > 0 ? fragments : [candidate]) {
          if (APPLICATION_LIKE_RE.test(fragment) || LOCATION_META_LIKE_RE.test(fragment)) {
            addItems(
              buckets.application_info,
              [fragment],
              0.58,
              {
                adapter,
                method: "heuristic",
                source_path: "responsibilities.sanitized",
                source_excerpt: fragment.slice(0, 200),
              },
              14
            )
            continue
          }

          if (COMPANY_LIKE_RE.test(fragment) || PROMOTIONAL_LIKE_RE.test(fragment)) {
            addItems(
              buckets.company_info,
              [fragment],
              0.56,
              {
                adapter,
                method: "heuristic",
                source_path: "responsibilities.sanitized",
                source_excerpt: fragment.slice(0, 200),
              },
              14
            )
            continue
          }

          if (BENEFITS_LIKE_RE.test(fragment)) {
            addItems(
              buckets.benefits,
              [fragment],
              0.56,
              {
                adapter,
                method: "heuristic",
                source_path: "responsibilities.sanitized",
                source_excerpt: fragment.slice(0, 200),
              },
              14
            )
          }
        }
        continue
      }

      const withoutLeadIn = candidate
        .replace(/^(what you(?:'|’)ll do|what you will do)\b[:\s-]*/i, "")
        .trim()

      if (withoutLeadIn.length < 16) continue

      const candidateProfileVoice =
        TRAIT_LEADIN_RE.test(withoutLeadIn) ||
        CANDIDATE_PROFILE_LIKE_RE.test(withoutLeadIn)
      const explicitResponsibilityVoice =
        /\byou\s+(?:'ll|’ll|will)\b/i.test(withoutLeadIn) ||
        /\byou\s+are\s+responsible\b/i.test(withoutLeadIn)
      if (candidateProfileVoice && !explicitResponsibilityVoice) {
        addItems(
          buckets.requirements,
          [withoutLeadIn],
          0.62,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (COMPENSATION_LIKE_RE.test(withoutLeadIn)) {
        addItems(
          buckets.compensation,
          [withoutLeadIn],
          0.6,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (PREFERRED_LIKE_RE.test(withoutLeadIn) || REQUIREMENT_LIKE_RE.test(withoutLeadIn)) {
        addItems(
          PREFERRED_LIKE_RE.test(withoutLeadIn)
            ? buckets.preferred_qualifications
            : buckets.requirements,
          [withoutLeadIn],
          0.6,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (BENEFITS_LIKE_RE.test(withoutLeadIn) || OFFER_CULTURE_LIKE_RE.test(withoutLeadIn)) {
        addItems(
          buckets.benefits,
          [withoutLeadIn],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (COMPANY_LIKE_RE.test(withoutLeadIn) || PROMOTIONAL_LIKE_RE.test(withoutLeadIn)) {
        addItems(
          buckets.company_info,
          [withoutLeadIn],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      const startsWithCompanyVoice =
        (/^(we|our)\b/i.test(withoutLeadIn) ||
          /^[A-Z][A-Za-z0-9&.' -]{1,48}\s+(is|are|has|have|was|were)\b/.test(withoutLeadIn)) &&
        !/\byou\b/i.test(withoutLeadIn)

      if (startsWithCompanyVoice && COMPANY_POSITIONING_RE.test(withoutLeadIn)) {
        addItems(
          buckets.company_info,
          [withoutLeadIn],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (RESPONSIBILITY_LIKE_RE.test(withoutLeadIn)) {
        kept.push(withoutLeadIn)
      }
    }
  }

  const refined = uniqCaseInsensitive(kept, 12)
  if (refined.length > 0) {
    buckets.responsibilities.items = refined
    buckets.responsibilities.provenance.push({
      adapter,
      method: "heuristic",
      source_path: "responsibilities.refined",
    })
    return
  }

  buckets.responsibilities.items = uniqCaseInsensitive(
    buckets.responsibilities.items.filter(
      (item) =>
        RESPONSIBILITY_LIKE_RE.test(item) &&
        !REQUIREMENT_LIKE_RE.test(item) &&
        !PREFERRED_LIKE_RE.test(item) &&
        !BENEFITS_LIKE_RE.test(item) &&
        !COMPANY_LIKE_RE.test(item) &&
        !PROMOTIONAL_LIKE_RE.test(item) &&
        !COMPANY_POSITIONING_RE.test(item) &&
        !/^(we|our)\b/i.test(item) &&
        !/^[A-Z][A-Za-z0-9&.' -]{1,48}\s+(is|are|has|have|was|were)\b/.test(item)
    ),
    8
  )
}

function sanitizeBenefitsBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.benefits.items.length === 0) return

  const kept: string[] = []

  for (const item of buckets.benefits.items) {
    const splitByApplicationMarkers = splitApplicationInfoFragments(item)
    const candidates =
      splitByApplicationMarkers.length > 0 && splitByApplicationMarkers.length !== 1
        ? splitByApplicationMarkers
        : item.length > 260
          ? splitIntoSentences(item).map((line) => line.trim())
          : [item]

    for (const candidate of candidates) {
      if (candidate.length < 14 || candidate.length > 220) continue

      const normalizedCandidate = candidate
        .replace(/^(additional\s+)?benefits?\s+for\s+this\s+role\s+may\s+include:\s*/i, "")
        .replace(/^for\s+this\s+role\s+may\s+include:\s*/i, "")
        .trim()
      if (normalizedCandidate.length < 12) continue

      // Drop travel/physical/office noise before any other routing
      if (NOISE_DISCARD_RE.test(normalizedCandidate)) continue

      if (EQUAL_OPPORTUNITY_LIKE_RE.test(normalizedCandidate)) {
        addItems(
          buckets.equal_opportunity,
          [normalizedCandidate],
          0.7,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          10
        )
        continue
      }

      if (APPLICATION_LIKE_RE.test(normalizedCandidate) || LOCATION_META_LIKE_RE.test(normalizedCandidate)) {
        addItems(
          buckets.application_info,
          [normalizedCandidate],
          0.6,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          14
        )
        continue
      }

      if (COMPENSATION_LIKE_RE.test(normalizedCandidate) && !BENEFITS_LIKE_RE.test(normalizedCandidate)) {
        addItems(
          buckets.compensation,
          [normalizedCandidate],
          0.58,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          14
        )
        continue
      }

      if (REQUIREMENT_LIKE_RE.test(normalizedCandidate) && !BENEFITS_LIKE_RE.test(normalizedCandidate)) {
        addItems(
          buckets.requirements,
          [normalizedCandidate],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          14
        )
        continue
      }

      if (
        RESPONSIBILITY_LIKE_RE.test(normalizedCandidate) &&
        !BENEFITS_LIKE_RE.test(normalizedCandidate) &&
        !OFFER_CULTURE_LIKE_RE.test(normalizedCandidate) &&
        !COMPENSATION_LIKE_RE.test(normalizedCandidate)
      ) {
        addItems(
          buckets.responsibilities,
          [normalizedCandidate],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          14
        )
        continue
      }

      if (
        BENEFITS_LIKE_RE.test(normalizedCandidate) ||
        OFFER_CULTURE_LIKE_RE.test(normalizedCandidate)
      ) {
        kept.push(normalizedCandidate)
        continue
      }

      if (COMPANY_LIKE_RE.test(normalizedCandidate) || PROMOTIONAL_LIKE_RE.test(normalizedCandidate)) {
        addItems(
          buckets.company_info,
          [normalizedCandidate],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          14
        )
        continue
      }

      // No catch-all: items reach this point only when nothing above matched,
      // including BENEFITS_LIKE_RE. Keeping them in benefits would let
      // mis-routed content (from a misclassified heading like
      // "...Careers Site for salary and benefits information") pollute the
      // visible "Benefits & perks" list. Drop instead — the section is meant
      // to be high-precision.
    }
  }

  buckets.benefits.items = uniqNearDuplicate(kept, 12)
}

function sanitizeSkillsBucket(buckets: Record<CanonicalSectionKey, SectionBucket>) {
  if (buckets.skills.items.length === 0) return

  buckets.skills.items = uniqCaseInsensitive(
    buckets.skills.items.filter((item) => {
      if (item.length > 140) return false
      if (SKILLS_HEADING_NOISE_RE.test(item.trim())) return false
      if (/[.!?]$/.test(item) && /\b(we|you|engineer|candidate|team|role)\b/i.test(item)) {
        return false
      }
      if (RESPONSIBILITY_LIKE_RE.test(item) && item.split(/\s+/).length > 8) return false
      if (COMPANY_LIKE_RE.test(item) || PROMOTIONAL_LIKE_RE.test(item)) return false
      return true
    }),
    12
  )
}

function sanitizeVisaBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.visa.items.length === 0) return

  const kept: string[] = []

  for (const item of buckets.visa.items) {
    const fragments = splitApplicationInfoFragments(item)
    const candidates = fragments.length > 0 ? fragments : splitIntoSentences(item)

    for (const candidateRaw of candidates) {
      const candidate = candidateRaw.trim()
      if (candidate.length < 12 || candidate.length > 320) continue
      if (/^(visa\s+)?sponsorship:?$/i.test(candidate)) continue

      if (EQUAL_OPPORTUNITY_LIKE_RE.test(candidate)) {
        addItems(
          buckets.equal_opportunity,
          [candidate],
          0.72,
          {
            adapter,
            method: "heuristic",
            source_path: "visa.sanitized",
            source_excerpt: candidate.slice(0, 200),
          },
          10
        )
        continue
      }

      if (APPLICATION_LIKE_RE.test(candidate) || /recruitment fraud|careers website/i.test(candidate)) {
        addItems(
          buckets.application_info,
          [candidate],
          0.58,
          {
            adapter,
            method: "heuristic",
            source_path: "visa.sanitized",
            source_excerpt: candidate.slice(0, 200),
          },
          14
        )
        continue
      }

      if (WORKDAY_FOOTER_META_RE.test(candidate)) continue
      if (VISA_LIKE_RE.test(candidate)) kept.push(candidate)
    }
  }

  buckets.visa.items = uniqNearDuplicate(kept, 8)
}

function sanitizeCompensationBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.compensation.items.length === 0) return

  const kept: string[] = []

  for (const item of buckets.compensation.items) {
    const candidates = item.length > 260
      ? splitIntoSentences(item).map((s) => s.trim())
      : [item]

    for (const candidate of candidates) {
      if (candidate.length < 14 || candidate.length > 360) continue

      // Drop travel/physical/boilerplate qualifiers
      if (NOISE_DISCARD_RE.test(candidate)) continue

      // Sentences that are purely about benefits (no salary signal) belong in benefits
      const hasSalarySignal = /\b(\$[\d,]+|\d{2,3}[,k]\d{3}|salary|pay(?: range)?|compensation|wages?|hourly|annual(?:\s+base)?|per\s+(?:year|hour|annum)|incentive|ote|on-target)\b/i.test(candidate)
      if (!hasSalarySignal && BENEFITS_LIKE_RE.test(candidate)) {
        addItems(
          buckets.benefits,
          [candidate],
          0.62,
          { adapter, method: "heuristic", source_path: "compensation.rerouted" },
          12
        )
        continue
      }

      if (EQUAL_OPPORTUNITY_LIKE_RE.test(candidate)) {
        addItems(
          buckets.equal_opportunity,
          [candidate],
          0.7,
          { adapter, method: "heuristic", source_path: "compensation.rerouted" },
          10
        )
        continue
      }

      kept.push(candidate)
    }
  }

  buckets.compensation.items = uniqNearDuplicate(kept, 6)
}

function sanitizeApplicationInfoBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.application_info.items.length === 0) return

  const kept: string[] = []
  for (const item of buckets.application_info.items) {
    const fragments = splitApplicationInfoFragments(item)
    for (const fragment of fragments.length > 0 ? fragments : [item]) {
      if (fragment.length < 12 || fragment.length > 220) continue

      if (COMPANY_LIKE_RE.test(fragment) || PROMOTIONAL_LIKE_RE.test(fragment)) {
        addItems(
          buckets.company_info,
          [fragment],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "application_info.sanitized",
            source_excerpt: fragment.slice(0, 200),
          },
          14
        )
        continue
      }

      if (BENEFITS_LIKE_RE.test(fragment)) {
        addItems(
          buckets.benefits,
          [fragment],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "application_info.sanitized",
            source_excerpt: fragment.slice(0, 200),
          },
          14
        )
        continue
      }

      if (EQUAL_OPPORTUNITY_LIKE_RE.test(fragment)) {
        addItems(
          buckets.equal_opportunity,
          [fragment],
          0.72,
          {
            adapter,
            method: "heuristic",
            source_path: "application_info.sanitized",
            source_excerpt: fragment.slice(0, 200),
          },
          10
        )
        continue
      }

      if (APPLICATION_LIKE_RE.test(fragment) || LOCATION_META_LIKE_RE.test(fragment)) {
        kept.push(fragment)
      }
    }
  }

  buckets.application_info.items = uniqNearDuplicate(kept, 12)
}

function refineAboutRole(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.about_role.items.length === 0) return

  // Filters keep the about_role section honest by stripping content that
  // belongs in other sections (responsibilities, requirements, preferred) or
  // is pure marketing fluff. We deliberately do NOT filter on COMPANY_LIKE_RE
  // or COMPANY_POSITIONING_RE: real "About the role" copy almost always
  // references the team, product, mission, or customer base.
  const candidates = buckets.about_role.items
    .flatMap((item) => splitIntoSentences(item))
    .map((item) => item.trim())
    .filter((item) => item.length >= 40 && item.length <= 260)
    .filter((item) => !ABOUT_BLOCKED_RE.test(item))
    .filter((item) => !RESPONSIBILITY_LIKE_RE.test(item))
    .filter((item) => !REQUIREMENT_LIKE_RE.test(item))
    .filter((item) => !PREFERRED_LIKE_RE.test(item))
    .filter((item) => !PROMOTIONAL_LIKE_RE.test(item))

  const refined = uniqCaseInsensitive(candidates, 3)
  if (refined.length > 0) {
    buckets.about_role.items = refined
    return
  }

  const fallback = splitIntoSentences(buckets.about_role.items[0] ?? "")
    .map((item) => item.trim())
    .filter((item) => item.length >= 40 && item.length <= 220)
    .filter((item) => !ABOUT_BLOCKED_RE.test(item))
    .filter((item) => !RESPONSIBILITY_LIKE_RE.test(item))
    .filter((item) => !REQUIREMENT_LIKE_RE.test(item))
    .filter((item) => !PREFERRED_LIKE_RE.test(item))
    .filter((item) => !PROMOTIONAL_LIKE_RE.test(item))
    .slice(0, 2)

  if (fallback.length > 0) {
    buckets.about_role.items = uniqCaseInsensitive(fallback, 2)
    buckets.about_role.isFallback = true
    buckets.about_role.provenance.push({
      adapter,
      method: "fallback",
      source_path: "about_role.refined",
    })
  }
}

function removeCrossSectionDuplicates(
  buckets: Record<CanonicalSectionKey, SectionBucket>
) {
  const seen = new Set<string>()
  const precedence: CanonicalSectionKey[] = [
    "skills",
    "preferred_qualifications",
    "requirements",
    "qualifications",
    "responsibilities",
    "about_role",
    "benefits",
    "company_info",
    "equal_opportunity",
    "application_info",
    "other",
  ]

  for (const key of precedence) {
    const bucket = buckets[key]
    const next: string[] = []
    for (const item of bucket.items) {
      const normalized = normalizeForCompare(item)
      if (!normalized) continue
      if (seen.has(normalized)) continue
      seen.add(normalized)
      next.push(item)
    }
    bucket.items = next
  }
}

function trimSectionItemCounts(buckets: Record<CanonicalSectionKey, SectionBucket>) {
  buckets.about_role.items = buckets.about_role.items.slice(0, 3)
  buckets.responsibilities.items = buckets.responsibilities.items.slice(0, 10)
  buckets.requirements.items = buckets.requirements.items.slice(0, 10)
  buckets.qualifications.items = buckets.qualifications.items.slice(0, 10)
  buckets.preferred_qualifications.items = buckets.preferred_qualifications.items.slice(0, 8)
  buckets.skills.items = buckets.skills.items.slice(0, 12)
  buckets.equal_opportunity.items = buckets.equal_opportunity.items.slice(0, 4)
}

export function extractCanonicalSections(input: {
  adapter: SourceAdapterKind
  description: string | null
  structuredSections?: Partial<Record<CanonicalSectionKey, string[]>>
}): Record<CanonicalSectionKey, CanonicalSection> {
  const buckets = createEmptyBuckets()

  for (const key of CANONICAL_SECTION_ORDER) {
    if (key === "header") continue
    const structuredItems = input.structuredSections?.[key] ?? []
    if (structuredItems.length === 0) continue

    addItems(
      buckets[key],
      structuredItems,
      0.95,
      {
        adapter: input.adapter,
        method: "structured",
        source_path: `structured.${key}`,
      },
      key === "other" ? 20 : 30
    )
  }

  if (input.description) {
    const description = normalizeGluedInlineHeadings(input.description)

    const explicitSegments = extractExplicitHeadingSegments(description)
    for (const segment of explicitSegments) {
      const classification = classifyHeading(segment.heading)
      const items = itemsFromTextBlock(segment.body)
      if (items.length === 0) continue

      addItems(
        buckets[classification.key],
        items,
        0.9,
        {
          adapter: input.adapter,
          method: "heading",
          source_path: "description",
          source_heading: segment.heading,
          source_excerpt: segment.body.slice(0, 240),
        },
        classification.key === "other" ? 18 : 30
      )
    }

    const inlineSegments = extractInlineHeadingSegments(description)
    for (const segment of inlineSegments) {
      const items = itemsFromTextBlock(segment.body)
      if (items.length === 0) continue

      addItems(
        buckets[segment.key],
        items,
        0.82,
        {
          adapter: input.adapter,
          method: "heading",
          source_path: "description.inline",
          source_heading: segment.heading,
          source_excerpt: segment.body.slice(0, 240),
        },
        segment.key === "other" ? 18 : 30
      )
    }

    const parsed = parseJobDescriptionSections(description)
    for (const section of parsed) {
      const items = flattenSectionContent(section)
      if (items.length === 0) continue

      const headingClassification = classifyHeading(section.heading)
      const textBlob = [section.heading, ...section.paragraphs, ...section.bullets]
        .filter(Boolean)
        .join(" ")
      const heuristicClassification = classifyTextByHeuristic(textBlob)

      const classification =
        headingClassification.key !== "other"
          ? headingClassification
          : heuristicClassification

      const method =
        headingClassification.key !== "other" ? "heading" : "heuristic"

      addItems(
        buckets[classification.key],
        items,
        classification.confidence,
        {
          adapter: input.adapter,
          method,
          source_path: "description",
          source_heading: section.heading,
          source_excerpt: textBlob.slice(0, 240),
        },
        classification.key === "other" ? 18 : 30
      )
    }

    fallbackFromFirstParagraphs(buckets, description, input.adapter)
    fallbackResponsibilities(buckets, input.adapter)
    fallbackRequirements(buckets, input.adapter)
    enrichFromMixedText(buckets, input.adapter)
    rebalanceQualificationBuckets(buckets, input.adapter)
    sanitizeResponsibilitiesBucket(buckets, input.adapter)
    sanitizeQualificationBuckets(buckets, input.adapter)
    sanitizeSkillsBucket(buckets)
    sanitizeVisaBucket(buckets, input.adapter)
    sanitizeCompensationBucket(buckets, input.adapter)
    sanitizeBenefitsBucket(buckets, input.adapter)
    sanitizeApplicationInfoBucket(buckets, input.adapter)
    refineAboutRole(buckets, input.adapter)
    removeCrossSectionDuplicates(buckets)
    trimSectionItemCounts(buckets)
  }

  const sections = {} as Record<CanonicalSectionKey, CanonicalSection>

  for (const key of CANONICAL_SECTION_ORDER) {
    const bucket = buckets[key]
    sections[key] = {
      key,
      label: sectionLabel(key),
      items: bucket.items,
      confidence: sectionConfidence(bucket),
      provenance: bucket.provenance,
      is_fallback: bucket.isFallback,
    }
  }

  return sections
}
