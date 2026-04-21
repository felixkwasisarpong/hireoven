const COMMON_ALIASES: Array<{ canonical: string; variants: string[] }> = [
  {
    canonical: "country_united_states",
    variants: [
      "united states of america",
      "united states",
      "u s a",
      "usa",
      "u s",
    ],
  },
  {
    canonical: "country_united_kingdom",
    variants: ["united kingdom", "great britain", "britain", "u k", "uk"],
  },
  {
    canonical: "country_united_arab_emirates",
    variants: ["united arab emirates", "u a e", "uae"],
  },
  {
    canonical: "remote",
    variants: ["work from home", "wfh", "remote"],
  },
]

const LOCATION_ONLY_ALIASES: Array<{ canonical: string; variants: string[] }> = [
  {
    canonical: "country_united_states",
    variants: ["us"],
  },
]

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeWhitespace(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeSearchText(
  value: string,
  options: { locationOnly?: boolean } = {}
) {
  let normalized = normalizeWhitespace(value)
  if (!normalized) return ""

  const aliases = options.locationOnly
    ? [...COMMON_ALIASES, ...LOCATION_ONLY_ALIASES]
    : COMMON_ALIASES

  for (const alias of aliases) {
    const variants = [...alias.variants].sort((left, right) => right.length - left.length)
    for (const variant of variants) {
      const normalizedVariant = normalizeWhitespace(variant)
      if (!normalizedVariant) continue
      const pattern = new RegExp(`\\b${escapeRegex(normalizedVariant)}\\b`, "g")
      normalized = normalized.replace(pattern, alias.canonical)
    }
  }

  return normalized
}

export function matchesSearchQuery(
  parts: Array<string | null | undefined>,
  query: string
) {
  const needle = normalizeSearchText(query)
  if (!needle) return true

  const haystack = normalizeSearchText(parts.filter(Boolean).join(" "))
  if (!haystack) return false

  return haystack.includes(needle)
}

export function matchesLocationFilter(
  location: string | null | undefined,
  query: string | null | undefined,
  options: { isRemote?: boolean } = {}
) {
  const needle = normalizeSearchText(query ?? "", { locationOnly: true })
  if (!needle) return true

  if (options.isRemote && needle === "remote") {
    return true
  }

  const haystack = normalizeSearchText(location ?? "", { locationOnly: true })
  return haystack.includes(needle)
}
