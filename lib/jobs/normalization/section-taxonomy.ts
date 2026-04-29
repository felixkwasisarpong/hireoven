import type { CanonicalSectionKey } from "@/lib/jobs/normalization/types"

export const CANONICAL_SECTION_ORDER: CanonicalSectionKey[] = [
  "header",
  "compensation",
  "visa",
  "about_role",
  "responsibilities",
  "requirements",
  "qualifications",
  "preferred_qualifications",
  "skills",
  "benefits",
  "company_info",
  "equal_opportunity",
  "application_info",
  "other",
]

export function sectionLabel(key: CanonicalSectionKey): string {
  if (key === "header") return "Header"
  if (key === "compensation") return "Compensation"
  if (key === "visa") return "Visa & Work Authorization"
  if (key === "about_role") return "About the role"
  if (key === "responsibilities") return "Responsibilities"
  if (key === "requirements") return "Requirements"
  if (key === "qualifications") return "Qualifications"
  if (key === "preferred_qualifications") return "Preferred qualifications"
  if (key === "skills") return "Skills"
  if (key === "benefits") return "Benefits"
  if (key === "company_info") return "Company info"
  if (key === "equal_opportunity") return "Equal opportunity"
  if (key === "application_info") return "Application info"
  return "Other"
}

type Rule = {
  key: CanonicalSectionKey
  pattern: RegExp
}

const HEADING_RULES: Rule[] = [
  {
    key: "about_role",
    pattern:
      /\b(about the role|about this role|role overview|job summary|position summary|overview|the opportunity|the position|role description|your role|the role|role purpose)\b/i,
  },
  {
    key: "responsibilities",
    pattern:
      /\b(responsibilit|what you(?:'|')ll do|what you will do|what you(?:'|')ll be doing|day-to-day|in this role|key duties|key responsibilities|your day|how you(?:'|')ll spend your time|how you(?:'|')ll make an impact|what you(?:'|')ll build|what you(?:'|')ll own|your impact|the work)\b/i,
  },
  {
    key: "requirements",
    pattern:
      /\b(requirements|minimum qualifications|required qualifications|basic qualifications|must have|must-have|what you bring|who you are|your profile|experience required|what we(?:'|')re looking for|what we are looking for|what you(?:'|')ll need|what you need to succeed|required experience|required skills)\b/i,
  },
  {
    key: "preferred_qualifications",
    pattern:
      /\b(preferred qualifications|nice to have|nice-to-have|bonus points|ideal candidate|good to have|would be a plus|additional qualifications|bonus qualifications|it(?:'|')s a plus|extra credit|great if you have|advantageous)\b/i,
  },
  {
    key: "qualifications",
    pattern:
      /\b(qualifications|candidate profile|what you need|what makes you qualified|your qualifications|to be successful|to qualify)\b/i,
  },
  {
    key: "skills",
    pattern:
      /\b(skills|technical skills|key skills|technologies|tech stack|tools|required tools|core skills|technical requirements)\b/i,
  },
  {
    key: "benefits",
    pattern:
      /\b(benefits|perks|what we offer|total rewards|wellbeing|health benefits|paid time off|life at|why join|why work here|our benefits|the perks)\b/i,
  },
  {
    key: "compensation",
    pattern:
      /\b(compensation|salary|pay range|total compensation|base pay|salary range|cash compensation|on-target earnings|ote)\b/i,
  },
  {
    key: "visa",
    pattern:
      /\b(visa|work authorization|immigration|sponsorship|h-?1b|h1b|opt|stem opt|authorized to work|work permit|right to work)\b/i,
  },
  {
    key: "company_info",
    pattern:
      /\b(about us|about the company|about the team|who we are|our mission|our values|culture|life at|company overview|our story|what we do|our product|the team|our team)\b/i,
  },
  {
    key: "application_info",
    pattern:
      /\b(how to apply|application process|privacy notice|interview process|next steps|recruitment process|hiring process|what to expect)\b/i,
  },
  {
    key: "equal_opportunity",
    pattern:
      /\b(equal opportunity|eeo|accommodation|reasonable accommodation|diverse workforce|protected veteran|affirmative action|diversity and inclusion|non-discrimination)\b/i,
  },
]

const CONTENT_RULES: Rule[] = [
  {
    key: "requirements",
    pattern:
      /\b(required|must|minimum|qualification|years? of experience|bachelor|master'?s|degree|proficiency|knowledge of|experience with|familiarity with|ability to|you have|you bring)\b/i,
  },
  {
    key: "skills",
    pattern:
      /\b(skills?|technologies|tools|programming languages?|frameworks?|cloud|databases?|devops)\b/i,
  },
  {
    key: "preferred_qualifications",
    pattern:
      /\b(preferred|nice to have|bonus|plus|ideally|would be a plus)\b/i,
  },
  {
    key: "benefits",
    pattern:
      /\b(health|dental|vision|401\s?\(k\)|retirement|pto|paid time off|parental leave|equity|bonus|wellness|stipend)\b/i,
  },
  {
    key: "compensation",
    pattern:
      /\b(\$\d|usd|base salary|pay range|total compensation|annually|yearly|per year)\b/i,
  },
  {
    key: "responsibilities",
    pattern:
      /\b(own|build|design|deliver|partner with|ship|drive|collaborate|maintain|develop|implement|support|manage)\b/i,
  },
  {
    key: "visa",
    pattern:
      /\b(visa|sponsor|sponsorship|authorized to work|employment authorization|h-?1b|opt|stem)\b/i,
  },
  {
    key: "company_info",
    pattern:
      /\b(our mission|our values|founded|we are|our culture|company|customers|global team)\b/i,
  },
  {
    key: "application_info",
    pattern:
      /\b(apply|application|recruitment process|background check)\b/i,
  },
  {
    key: "equal_opportunity",
    pattern:
      /\b(equal opportunity|eeo|accommodation|reasonable accommodation|protected veteran|affirmative action)\b/i,
  },
]

export function classifyHeading(
  heading: string | null | undefined
): { key: CanonicalSectionKey; confidence: number } {
  const value = heading?.trim()
  if (!value) return { key: "other", confidence: 0.32 }

  for (const rule of HEADING_RULES) {
    if (rule.pattern.test(value)) {
      return { key: rule.key, confidence: 0.88 }
    }
  }

  return { key: "other", confidence: 0.32 }
}

export function classifyTextByHeuristic(text: string): {
  key: CanonicalSectionKey
  confidence: number
} {
  const normalized = text.trim()
  if (!normalized) return { key: "other", confidence: 0.25 }

  const requirementHit = CONTENT_RULES.find((rule) => rule.key === "requirements")?.pattern.test(normalized)
  const preferredHit = CONTENT_RULES.find((rule) => rule.key === "preferred_qualifications")?.pattern.test(normalized)
  const benefitHit = CONTENT_RULES.find((rule) => rule.key === "benefits")?.pattern.test(normalized)
  const compensationHit = CONTENT_RULES.find((rule) => rule.key === "compensation")?.pattern.test(normalized)
  const responsibilityHit = CONTENT_RULES.find((rule) => rule.key === "responsibilities")?.pattern.test(normalized)

  if (benefitHit) return { key: "benefits", confidence: 0.78 }
  if (compensationHit) return { key: "compensation", confidence: 0.78 }
  if (preferredHit) return { key: "preferred_qualifications", confidence: 0.76 }
  if (requirementHit) return { key: "requirements", confidence: responsibilityHit ? 0.74 : 0.78 }

  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(normalized)) {
      return { key: rule.key, confidence: 0.7 }
    }
  }

  return { key: "other", confidence: 0.25 }
}

export function uniqCaseInsensitive(values: string[], max = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = []
  for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
    if (out.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue
    out.push(value)
    if (out.length >= max) break
  }
  return out
}
