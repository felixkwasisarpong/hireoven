import type { AutofillProfile } from "@/types"

export type FieldMapping = {
  autofillKey: keyof AutofillProfile
  patterns: string[]
  transform?: (value: unknown, profile: AutofillProfile) => string
}

export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone
}

export const FIELD_MAPPINGS: FieldMapping[] = [
  {
    autofillKey: "first_name",
    patterns: ["first.?name", "fname", "given.?name", "\\bfirst\\b", "^name$"],
  },
  {
    autofillKey: "last_name",
    patterns: ["last.?name", "lname", "family.?name", "surname", "\\blast\\b"],
  },
  {
    autofillKey: "email",
    patterns: ["e.?mail", "email.?address"],
  },
  {
    autofillKey: "phone",
    patterns: ["phone", "mobile", "cell", "telephone", "contact.?number", "phone.?number"],
    transform: (value) => formatPhoneNumber(String(value)),
  },
  {
    autofillKey: "linkedin_url",
    patterns: ["linkedin", "linked.?in", "linkedin.?url", "linkedin.?profile"],
  },
  {
    autofillKey: "github_url",
    patterns: ["github", "git.?hub", "github.?url", "github.?profile"],
  },
  {
    autofillKey: "portfolio_url",
    patterns: [
      "portfolio",
      "personal.?site",
      "portfolio.?url",
      "personal.?website",
      "\\bwebsite\\b",
    ],
  },
  {
    autofillKey: "website_url",
    patterns: ["website", "personal.?url", "web.?address"],
  },
  {
    autofillKey: "address_line1",
    patterns: ["address.?line.?1", "\\baddress\\b", "street.?address", "mailing.?address"],
  },
  {
    autofillKey: "address_line2",
    patterns: ["address.?line.?2", "apartment", "\\bapt\\b", "suite", "unit"],
  },
  {
    autofillKey: "city",
    patterns: ["\\bcity\\b", "\\btown\\b", "municipality"],
  },
  {
    autofillKey: "state",
    patterns: ["\\bstate\\b", "\\bprovince\\b", "\\bregion\\b"],
  },
  {
    autofillKey: "zip_code",
    patterns: ["\\bzip\\b", "postal", "zip.?code", "postcode"],
  },
  {
    autofillKey: "country",
    patterns: ["\\bcountry\\b", "nation", "country.?of.?residence"],
  },
  {
    autofillKey: "authorized_to_work",
    patterns: [
      "authorized.?to.?work",
      "eligible.?to.?work",
      "legally.?authorized",
      "work.?authoriz",
    ],
    transform: (value) => (value ? "Yes" : "No"),
  },
  {
    autofillKey: "requires_sponsorship",
    patterns: ["require.?sponsor", "need.?sponsor", "visa.?sponsor", "h.?1b", "future.?sponsor"],
    transform: (value) => (value ? "Yes" : "No"),
  },
  {
    autofillKey: "sponsorship_statement",
    patterns: [
      "sponsor.*detail",
      "authoriz.*explain",
      "additional.*visa",
      "visa.*status.*detail",
      "work.*auth.*comment",
    ],
  },
  {
    autofillKey: "gender",
    patterns: ["gender", "gender.?identity"],
  },
  {
    autofillKey: "ethnicity",
    patterns: ["ethnicity", "race", "racial.?identity"],
  },
  {
    autofillKey: "veteran_status",
    patterns: ["veteran", "protected.?veteran", "military.?status"],
  },
  {
    autofillKey: "disability_status",
    patterns: ["disability", "disability.?status"],
  },
  {
    autofillKey: "years_of_experience",
    patterns: [
      "years.?of.?exp",
      "experience.?years",
      "how.?many.?years",
      "total.?experience",
      "years.*relevant",
    ],
    transform: (value) => String(value),
  },
  {
    autofillKey: "salary_expectation_min",
    patterns: [
      "salary",
      "compensation",
      "expected.?salary",
      "desired.?salary",
      "salary.?expect",
      "pay.?expect",
    ],
    transform: (_value, profile) => {
      const min = profile.salary_expectation_min
      const max = profile.salary_expectation_max
      if (min && max) return `$${min.toLocaleString()} - $${max.toLocaleString()}`
      if (min) return `$${min.toLocaleString()}`
      return ""
    },
  },
  {
    autofillKey: "earliest_start_date",
    patterns: ["start.?date", "available.*start", "notice.?period", "when.*start", "earliest.*available"],
  },
  {
    autofillKey: "willing_to_relocate",
    patterns: ["relocat", "willing.?to.?move", "open.?to.?reloc"],
    transform: (value) => (value ? "Yes" : "No"),
  },
  {
    autofillKey: "preferred_work_type",
    patterns: ["work.?type", "work.?arrangement", "remote.*onsite", "work.*location.*prefer"],
  },
  {
    autofillKey: "highest_degree",
    patterns: ["degree", "education.?level", "highest.?edu", "academic.?level"],
  },
  {
    autofillKey: "field_of_study",
    patterns: ["field.?of.?study", "major", "area.?of.?study", "concentration"],
  },
  {
    autofillKey: "university",
    patterns: ["university", "college", "\\bschool\\b", "institution", "alma.?mater"],
  },
  {
    autofillKey: "graduation_year",
    patterns: ["grad.?year", "graduation.?year", "class.?of", "year.?graduated"],
    transform: (value) => String(value),
  },
  {
    autofillKey: "gpa",
    patterns: ["\\bgpa\\b", "grade.?point", "academic.*average", "cumulative.*gpa"],
  },
]

export type MatchResult = {
  value: string
  confidence: number
  fieldKey: keyof AutofillProfile
}

export function matchFieldToProfile(
  fieldLabel: string,
  fieldName: string,
  fieldId: string,
  profile: AutofillProfile
): MatchResult | null {
  const combined = [fieldLabel, fieldName, fieldId]
    .join(" ")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .trim()

  if (!combined) return null

  let bestMatch: MatchResult | null = null

  for (const mapping of FIELD_MAPPINGS) {
    const rawValue = profile[mapping.autofillKey]
    if (rawValue === null || rawValue === undefined || rawValue === "") continue
    if (
      !profile.auto_fill_diversity &&
      ["gender", "ethnicity", "veteran_status", "disability_status"].includes(mapping.autofillKey)
    ) {
      continue
    }

    for (const pattern of mapping.patterns) {
      const regex = new RegExp(pattern, "i")
      if (regex.test(combined)) {
        const value = mapping.transform
          ? mapping.transform(rawValue, profile)
          : String(rawValue)

        if (!value) continue

        // Exact id/name match gets highest confidence
        const exactMatch = new RegExp(`^${pattern}$`, "i").test(fieldName) ||
          new RegExp(`^${pattern}$`, "i").test(fieldId)
        const confidence = exactMatch ? 1.0 : 0.8

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { value, confidence, fieldKey: mapping.autofillKey }
        }
        break
      }
    }
  }

  // Check custom answers
  if (profile.custom_answers?.length) {
    for (const qa of profile.custom_answers) {
      if (!qa.question_pattern?.trim() || !qa.answer?.trim()) continue
      try {
        const regex = new RegExp(qa.question_pattern, "i")
        if (regex.test(combined)) {
          if (!bestMatch || 0.7 > bestMatch.confidence) {
            bestMatch = { value: qa.answer.trim(), confidence: 0.7, fieldKey: "custom_answers" }
          }
        }
      } catch {
        continue
      }
    }
  }

  return bestMatch && bestMatch.confidence >= 0.6 ? bestMatch : null
}
