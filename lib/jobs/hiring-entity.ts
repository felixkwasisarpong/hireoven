type JsonRecord = Record<string, unknown>

export type HiringEntitySignal = {
  display_name: string | null
  end_client_name: string | null
  staffing_company_name: string | null
  is_staffing_intermediary: boolean
  confidence: number
  source: string
}

const STAFFING_NAME_RE =
  /\b(staffing|recruit(?:er|ing|ment)|talent|placement|outsourc(?:e|ing)|consult(?:ing|ancy)|resourc(?:e|ing)|contract(?:or|ing)?)\b/i

const CLIENT_SIGNAL_RE =
  /\b(our client|end[-\s]?client|client(?: company)?|on behalf of|vendor role|c2c|corp(?:oration)?[-\s]*to[-\s]*corp|w2 contract)\b/i

const CLIENT_CAPTURE_PATTERNS: Array<{ source: string; re: RegExp }> = [
  {
    source: "end_client_label",
    // Separator must be a colon, or "is"/dash/em-dash surrounded by whitespace.
    // A glued hyphen is NOT a separator, so compound words like "client-side",
    // "client-facing", "client-server" don't get misread as "client: <value>".
    re: /\b(?:end[-\s]?client|client company|client name|client)(?:\s*:\s*|\s+(?:is\s+|[-—]\s+))([A-Za-z0-9][^\n.;|]{1,96})/i,
  },
  {
    source: "our_client",
    re: /\bfor\s+our\s+client[,]?\s*([A-Za-z0-9][^\n.;|]{1,96})/i,
  },
  {
    source: "on_behalf",
    re: /\bon\s+behalf\s+of\s+(?:our\s+client\s+)?([A-Za-z0-9][^\n.;|]{1,96})/i,
  },
  {
    source: "client_is",
    re: /\bour\s+client\s+is\s+([A-Za-z0-9][^\n.;|]{1,96})/i,
  },
]

const INVALID_CANDIDATE_RE =
  /\b(client|company|organization|employer|role|position|opening|opportunity|confidential|stealth|fortune\s*\d{2,3})\b/i

const LEGAL_SUFFIX_RE =
  /\b(incorporated|inc|corp|corporation|company|co|llc|l\.?l\.?c\.?|llp|ltd|limited|plc)\b/g

function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function cleanCandidate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const singleLine = normalizeSpacing(value.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'"))
  if (!singleLine) return null

  const trimmedClause = singleLine.replace(
    /,\s*(?:we|you|they|the|this|that|who|is|are|will|can|please|kindly|send|email|contact|submit|share|forward|reach|seeks?|seeking|hiring|looking)\b.*$/i,
    ""
  )
  const stopWords = trimmedClause.split(/\s+(?:in|at|for|to|who|that|where|with)\b/i)[0] ?? trimmedClause
  const stripped = normalizeSpacing(
    stopWords
      .replace(/^[,:;\-–—.\s]+/, "")
      .replace(/[,:;\-–—.\s]+$/, "")
      .replace(/^the\s+/i, "")
      .replace(/^a\s+/i, "")
  )

  if (!stripped) return null
  if (stripped.length < 2 || stripped.length > 80) return null
  if (/(https?:\/\/|www\.|@)/i.test(stripped)) return null
  if (INVALID_CANDIDATE_RE.test(stripped) && stripped.split(/\s+/).length <= 3) return null

  const letters = (stripped.match(/[A-Za-z]/g) ?? []).length
  if (letters < 1) return null

  return stripped
}

function normalizeCompanyForCompare(value: string | null | undefined): string {
  const candidate = cleanCandidate(value)
  if (!candidate) return ""
  return normalizeSpacing(
    candidate
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(LEGAL_SUFFIX_RE, " ")
  ).replace(/\s+/g, " ")
}

export function looksLikeStaffingCompanyName(companyName: string | null | undefined): boolean {
  const cleaned = cleanCandidate(companyName)
  if (!cleaned) return false
  return STAFFING_NAME_RE.test(cleaned)
}

export function extractLikelyHiringEntityFromDescription(description: string | null | undefined): {
  name: string
  source: string
} | null {
  if (typeof description !== "string" || !description.trim()) return null
  const text = description.replace(/\r/g, "\n")

  for (const pattern of CLIENT_CAPTURE_PATTERNS) {
    const match = pattern.re.exec(text)
    const candidate = cleanCandidate(match?.[1] ?? null)
    if (candidate) {
      return { name: candidate, source: pattern.source }
    }
  }

  return null
}

function computeConfidence(args: {
  hasClientSignal: boolean
  hasEndClientName: boolean
  companyLooksStaffing: boolean
}): number {
  let confidence = 0.6
  if (args.hasClientSignal) confidence += 0.1
  if (args.hasEndClientName) confidence += 0.16
  if (args.companyLooksStaffing) confidence += 0.1
  return Math.max(0, Math.min(0.96, Number(confidence.toFixed(2))))
}

export function resolveHiringEntitySignal(input: {
  companyName: string | null | undefined
  description: string | null | undefined
}): HiringEntitySignal | null {
  const staffingCompanyName = cleanCandidate(input.companyName)
  const extracted = extractLikelyHiringEntityFromDescription(input.description)
  const extractedName = extracted?.name ?? null
  const hasClientSignal =
    typeof input.description === "string" && CLIENT_SIGNAL_RE.test(input.description)
  const companyLooksStaffing = looksLikeStaffingCompanyName(staffingCompanyName)

  const normalizedStaffing = normalizeCompanyForCompare(staffingCompanyName)
  const normalizedExtracted = normalizeCompanyForCompare(extractedName)
  const namesDiffer =
    Boolean(normalizedExtracted) &&
    Boolean(normalizedStaffing) &&
    normalizedExtracted !== normalizedStaffing

  const isStaffingIntermediary =
    hasClientSignal && (companyLooksStaffing || namesDiffer)

  if (!isStaffingIntermediary && !namesDiffer) return null

  const displayName =
    namesDiffer && extractedName
      ? extractedName
      : staffingCompanyName

  if (!displayName) return null

  return {
    display_name: displayName,
    end_client_name: namesDiffer ? extractedName : null,
    staffing_company_name: staffingCompanyName,
    is_staffing_intermediary: isStaffingIntermediary,
    confidence: computeConfidence({
      hasClientSignal,
      hasEndClientName: Boolean(extractedName),
      companyLooksStaffing,
    }),
    source: extracted?.source ?? (hasClientSignal ? "client_signal_only" : "name_difference"),
  }
}

function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true") return true
    if (normalized === "false") return false
  }
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function readHiringEntitySignalFromRawData(
  rawData: JsonRecord | null | undefined
): HiringEntitySignal | null {
  if (!rawData) return null

  const rawSignal = asObject(rawData.hiring_entity)
  if (rawSignal) {
    const displayName = cleanCandidate(rawSignal.display_name as string | null | undefined)
    const endClientName = cleanCandidate(rawSignal.end_client_name as string | null | undefined)
    const staffingCompany = cleanCandidate(rawSignal.staffing_company_name as string | null | undefined)
    const isStaffing =
      asBoolean(rawSignal.is_staffing_intermediary) ??
      false
    const confidence = Math.max(
      0,
      Math.min(1, asNumber(rawSignal.confidence) ?? 0)
    )
    const source = cleanCandidate(rawSignal.source as string | null | undefined) ?? "unknown"

    if (displayName || endClientName || staffingCompany || isStaffing) {
      return {
        display_name: displayName ?? endClientName ?? staffingCompany,
        end_client_name: endClientName,
        staffing_company_name: staffingCompany,
        is_staffing_intermediary: isStaffing,
        confidence,
        source,
      }
    }
  }

  const structured = asObject(rawData.structured_job)
  const structuredName = cleanCandidate(structured?.hiringCompany as string | null | undefined)
  if (structuredName) {
    return {
      display_name: structuredName,
      end_client_name: structuredName,
      staffing_company_name: null,
      is_staffing_intermediary: true,
      confidence: 0.6,
      source: "structured_job_fallback",
    }
  }

  return null
}

export function resolveDisplayCompanyName(input: {
  companyName: string | null | undefined
  rawData?: JsonRecord | null | undefined
}): string {
  const signal = readHiringEntitySignalFromRawData(input.rawData ?? null)
  const preferred =
    cleanCandidate(signal?.display_name) ??
    cleanCandidate(signal?.end_client_name) ??
    cleanCandidate(input.companyName)
  return preferred ?? "Unknown company"
}

export function isStaffingIntermediaryListing(input: {
  rawData?: JsonRecord | null | undefined
}): boolean {
  const signal = readHiringEntitySignalFromRawData(input.rawData ?? null)
  return signal?.is_staffing_intermediary === true
}
