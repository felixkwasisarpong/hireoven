import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getResumeVersion } from "@/lib/matching/fast-scorer"
import { isScoreFreshForResume } from "@/lib/matching/score-freshness"
import { getJobNetworkingContacts, type NetworkingContact } from "@/lib/networking/job-contact-finder"
import { getPostgresErrorCode, getPostgresPool } from "@/lib/postgres/server"
import { isUuid } from "@/lib/resume/hub"
import { normalizeTitle } from "@/lib/rejections/pattern-computer"
import type { MatchScoreBreakdown } from "@/types"
import { scoreApplicationXRay } from "../scorer"
import type { ApplicationXRayInput } from "../inputs"
import {
  APPLICATION_XRAY_SCHEMA_VERSION,
  type ActionableAccessRoute,
  type ApplicationXRay,
  type XRayDataGap,
  type XRaySourceFact,
} from "../types"
import { mapCandidateAuthorization, mapEmployerActionFeasibility, mapSponsorshipHistory } from "./map-candidate"
import { applyCachedGhostStatus, mapJobRecord, selectSignalJob } from "./map-job"
import {
  baseSourceFacts,
  mapAccessRoutes,
  mapCapability,
  mapEvidenceAndPositioning,
  mapHiringReality,
  mapPostingAuthorizationRequirements,
  mapReferralAdvisory,
  mapResumeInput,
} from "./map-signals"
import type {
  ApplicationXRayResponsePayload,
  JsonRecord,
  XRayApplicationRow,
  XRayAutofillRow,
  XRayCompanyRow,
  XRayCredentialDeclarationRow,
  XRayGhostScoreRow,
  XRayHealthScoreRow,
  XRayJobRow,
  XRayLoadedData,
  XRayProfileRow,
  XRayQueryable,
  XRayRejectionPatternRow,
  XRayResumeRow,
  XRayScoreRow,
} from "./records"
import { sanitizeApplicationXRayOutput } from "./sanitize-output"

const MAX_CANONICAL_HOPS = 3
const GHOST_CACHE_MAX_HOURS = 24
const REJECTION_PATTERN_MAX_DAYS = 180
const HIDDEN_STATUSES_EXCLUDED_FROM_XRAY = [
  "hidden_invalid",
  "hidden_low_quality",
] as const

export class ApplicationXRayLoadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApplicationXRayLoadError"
  }
}

export type LoadApplicationXRayInputOptions = {
  userId: string
  jobId: string
  resumeId?: string | null
  now: string
  pool?: XRayQueryable
  loadNetworkingContacts?: (input: { jobId: string; userId: string }) => Promise<NetworkingContact[]>
}

export async function getApplicationXRayForUser(
  options: LoadApplicationXRayInputOptions,
): Promise<ApplicationXRayResponsePayload> {
  const loaded = await loadApplicationXRayInput(options)
  const input = buildApplicationXRayInput(loaded)
  const scored = scoreApplicationXRay(input)
  const xray = sanitizeApplicationXRayOutput(scored)

  return {
    xray,
    meta: {
      requestedJobId: loaded.requestedJobId,
      evaluatedJobId: xray.evaluatedJobId,
      resumeId: xray.resumeId,
      computedAt: xray.computedAt,
      schemaVersion: APPLICATION_XRAY_SCHEMA_VERSION,
    },
  }
}

export async function loadApplicationXRayInput(
  options: LoadApplicationXRayInputOptions,
): Promise<XRayLoadedData> {
  if (!isUuid(options.jobId)) {
    throw new ApplicationXRayLoadError(400, "MALFORMED_JOB_ID", "Malformed job id")
  }
  if (options.resumeId && !isUuid(options.resumeId)) {
    throw new ApplicationXRayLoadError(400, "MALFORMED_RESUME_ID", "Malformed resume id")
  }

  const pool = options.pool ?? getPostgresPool()
  const dataGaps: XRayDataGap[] = []
  const optionalWarnings: string[] = []
  const sourceFacts: XRaySourceFact[] = []

  const requestedJob = await loadJobById(pool, options.jobId)
  if (!requestedJob) {
    throw new ApplicationXRayLoadError(404, "JOB_NOT_FOUND", "Job not found")
  }
  const jobRows = await loadCanonicalJobRows(pool, requestedJob)
  const selectedJob = selectSignalJob(jobRows, requestedJob.id) ?? requestedJob

  const [profile, defaultResumeId, autofillProfile] = await Promise.all([
    loadProfile(pool, options.userId),
    loadDefaultResumeId(pool, options.userId, optionalWarnings),
    loadAutofillProfile(pool, options.userId, optionalWarnings),
  ])

  const resume = await resolveResume({
    pool,
    userId: options.userId,
    explicitResumeId: options.resumeId ?? null,
    defaultResumeId,
    optionalWarnings,
  })

  const [matchResult, ghostScore, healthScore, rejectionPattern, applications, credentialDeclarations, accessRoutes] =
    await Promise.all([
      loadFreshMatchScore(pool, {
        userId: options.userId,
        jobId: selectedJob.id,
        resume,
        optionalWarnings,
      }),
      loadCachedGhostScore(pool, selectedJob.id, options.now, dataGaps, optionalWarnings),
      loadCachedHealthScore(pool, selectedJob.company_id, optionalWarnings),
      loadRejectionPattern(pool, selectedJob, options.now, optionalWarnings),
      loadApplications(pool, options.userId, jobRows.map((row) => row.id), optionalWarnings),
      loadCredentialDeclarations(pool, options.userId, optionalWarnings),
      loadAccessRoutes(
        selectedJob.id,
        options.userId,
        options.now,
        sourceFacts,
        optionalWarnings,
        options.loadNetworkingContacts,
      ),
    ])

  appendRawXRaySourceFacts(selectedJob.raw_data, sourceFacts)

  return {
    now: options.now,
    userId: options.userId,
    requestedJobId: requestedJob.id,
    selectedJob,
    requestedJob,
    jobRows,
    profile,
    defaultResumeId,
    autofillProfile,
    resume,
    explicitResumeId: options.resumeId ?? null,
    matchScore: matchResult.score,
    computedMatchBreakdown: matchResult.computedBreakdown,
    matchScoreFresh: matchResult.freshness,
    ghostScore,
    healthScore,
    rejectionPattern,
    applications,
    credentialDeclarations,
    accessRoutes,
    sourceFacts,
    dataGaps,
    optionalWarnings,
  }
}

export function buildApplicationXRayInput(loaded: XRayLoadedData): ApplicationXRayInput {
  const sourceFacts = [
    ...baseSourceFacts({
      job: loaded.selectedJob,
      resume: loaded.resume,
      score: loaded.matchScore,
      ghost: loaded.ghostScore,
      health: loaded.healthScore,
      applications: loaded.applications,
    }),
    ...loaded.sourceFacts,
  ]
  appendCompanySourceFacts(loaded.selectedJob?.company ?? null, sourceFacts)

  const candidate = mapCandidateAuthorization({
    profile: loaded.profile,
    autofillProfile: loaded.autofillProfile,
    job: loaded.selectedJob,
    now: loaded.now,
  })
  const postingRequirements = mapPostingAuthorizationRequirements({
    job: loaded.selectedJob,
    sourceFacts,
  })
  const employerActionFeasibility = mapEmployerActionFeasibility({
    job: loaded.selectedJob,
    candidate,
    postingRequirements,
  })
  const sponsorshipHistory = mapSponsorshipHistory({
    company: loaded.selectedJob?.company,
    employerActionFeasibility,
    now: loaded.now,
  })
  const capability = mapCapability({
    resume: loaded.resume,
    job: loaded.selectedJob,
    score: loaded.matchScore,
    computedBreakdown: loaded.computedMatchBreakdown,
    scoreFresh: loaded.matchScoreFresh,
    credentialDeclarations: loaded.credentialDeclarations,
    sourceFacts,
    now: loaded.now,
    dataGaps: loaded.dataGaps,
  })
  const { evidence, positioning } = mapEvidenceAndPositioning({
    resume: loaded.resume,
    job: loaded.selectedJob,
    score: loaded.matchScore,
    computedBreakdown: loaded.computedMatchBreakdown,
  })

  return {
    now: loaded.now,
    requestedJobId: loaded.requestedJobId,
    userId: loaded.userId,
    resume: mapResumeInput(loaded.resume),
    jobRecords: loaded.jobRows.map((row) => {
      const record = mapJobRecord(row, loaded.now)
      return row.id === loaded.selectedJob?.id
        ? applyCachedGhostStatus(record, loaded.ghostScore)
        : record
    }),
    capability,
    evidence,
    positioning,
    hiringReality: mapHiringReality({
      ghost: loaded.ghostScore,
      health: loaded.healthScore,
      job: loaded.selectedJob,
      now: loaded.now,
    }),
    eligibility: {
      candidate,
      postingRequirements,
      sponsorshipHistory,
      employerActionFeasibility,
      otherConstraints: [],
      confidence: "medium",
    },
    accessRoutes: mapAccessRoutes(loaded.accessRoutes),
    referralAdvisory: mapReferralAdvisory({
      pattern: loaded.rejectionPattern,
      job: loaded.selectedJob,
    }),
    sourceFacts: dedupeSourceFacts(sourceFacts),
    dataGaps: loaded.dataGaps,
  }
}

async function loadJobById(pool: XRayQueryable, jobId: string): Promise<XRayJobRow | null> {
  const result = await pool.query<XRayJobRow>(
    `SELECT
       j.id::text,
       j.company_id::text,
       j.duplicate_of_id::text,
       j.title,
       j.normalized_title,
       j.description,
       j.apply_url,
       j.content_hash::text,
       j.raw_data,
       j.skills,
       j.source_ats,
       j.source_ats_slug,
       j.external_id,
       j.is_active,
       j.publication_status,
       j.closed_at::text,
       j.first_detected_at::text,
       j.last_seen_at::text,
       j.posted_at::text,
       j.is_remote,
       j.location,
       j.employment_type,
       j.seniority_level,
       j.sponsors_h1b,
       j.requires_authorization,
       j.visa_language_detected,
       j.h1b_prediction,
       j.h1b_prediction_at::text,
       to_jsonb(c.*) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1::uuid
       AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
       AND COALESCE(j.publication_status, 'published') <> ALL($2::text[])
     LIMIT 1`,
    [jobId, [...HIDDEN_STATUSES_EXCLUDED_FROM_XRAY]],
  )
  return result.rows[0] ?? null
}

async function loadCanonicalJobRows(pool: XRayQueryable, requested: XRayJobRow): Promise<XRayJobRow[]> {
  const rows = [requested]
  const seen = new Set<string>([requested.id])
  let current = requested

  for (let hops = 0; hops < MAX_CANONICAL_HOPS; hops += 1) {
    const nextId = current.duplicate_of_id
    if (!nextId) break
    if (seen.has(nextId)) break
    const next = await loadJobById(pool, nextId)
    if (!next) break
    rows.push(next)
    seen.add(next.id)
    current = next
  }

  return rows
}

async function loadProfile(pool: XRayQueryable, userId: string): Promise<XRayProfileRow | null> {
  const result = await pool.query<XRayProfileRow>(
    `SELECT * FROM profiles WHERE id = $1::uuid LIMIT 1`,
    [userId],
  )
  return result.rows[0] ?? null
}

async function loadDefaultResumeId(
  pool: XRayQueryable,
  userId: string,
  warnings: string[],
): Promise<string | null> {
  const result = await optionalQuery<{ default_resume_id: string | null }>(
    pool,
    `SELECT default_resume_id::text FROM profiles WHERE id = $1::uuid LIMIT 1`,
    [userId],
    "profiles.default_resume_id",
    warnings,
  )
  return result?.rows[0]?.default_resume_id ?? null
}

async function loadAutofillProfile(
  pool: XRayQueryable,
  userId: string,
  warnings: string[],
): Promise<XRayAutofillRow | null> {
  const result = await optionalQuery<XRayAutofillRow>(
    pool,
    `SELECT id::text, user_id::text, first_name, last_name, email, phone,
            city, state, country, linkedin_url, github_url, portfolio_url,
            website_url, work_authorization, requires_sponsorship,
            authorized_to_work, sponsorship_statement, years_of_experience,
            highest_degree, field_of_study, university, graduation_year,
            created_at::text, updated_at::text
       FROM autofill_profiles
      WHERE user_id = $1::uuid
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userId],
    "autofill_profiles",
    warnings,
  )
  return result?.rows[0] ?? null
}

async function resolveResume(input: {
  pool: XRayQueryable
  userId: string
  explicitResumeId: string | null
  defaultResumeId: string | null
  optionalWarnings: string[]
}): Promise<XRayResumeRow | null> {
  if (input.explicitResumeId) {
    const resume = await loadOwnedResumeById(input.pool, input.userId, input.explicitResumeId)
    if (!resume) {
      throw new ApplicationXRayLoadError(404, "RESUME_NOT_FOUND", "Resume not found")
    }
    return resume
  }

  if (input.defaultResumeId && isUuid(input.defaultResumeId)) {
    const resume = await loadOwnedResumeById(input.pool, input.userId, input.defaultResumeId)
    if (isUsableResume(resume)) return resume
  }

  return loadPrimaryOrLatestResume(input.pool, input.userId, input.optionalWarnings)
}

async function loadOwnedResumeById(
  pool: XRayQueryable,
  userId: string,
  resumeId: string,
): Promise<XRayResumeRow | null> {
  const result = await pool.query<XRayResumeRow>(
    `SELECT * FROM resumes WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [resumeId, userId],
  )
  return result.rows[0] ?? null
}

async function loadPrimaryOrLatestResume(
  pool: XRayQueryable,
  userId: string,
  warnings: string[],
): Promise<XRayResumeRow | null> {
  const withArchive = await optionalQuery<XRayResumeRow>(
    pool,
    `SELECT *
       FROM resumes
      WHERE user_id = $1::uuid
        AND parse_status = 'complete'
        AND archived_at IS NULL
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 1`,
    [userId],
    "resumes.archived_at",
    warnings,
  )
  if (withArchive !== null) return withArchive.rows[0] ?? null

  const fallback = await pool.query<XRayResumeRow>(
    `SELECT *
       FROM resumes
      WHERE user_id = $1::uuid
        AND parse_status = 'complete'
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 1`,
    [userId],
  )
  return fallback.rows[0] ?? null
}

function isUsableResume(resume: XRayResumeRow | null): resume is XRayResumeRow {
  return Boolean(resume && resume.parse_status === "complete")
}

async function loadFreshMatchScore(
  pool: XRayQueryable,
  input: {
    userId: string
    jobId: string
    resume: XRayResumeRow | null
    optionalWarnings: string[]
  },
): Promise<{
  score: XRayScoreRow | null
  computedBreakdown: MatchScoreBreakdown | null
  freshness: XRayLoadedData["matchScoreFresh"]
}> {
  if (!input.resume) {
    return { score: null, computedBreakdown: null, freshness: "missing" }
  }

  const result = await optionalQuery<XRayScoreRow>(
    pool,
    `SELECT jms.*, r.updated_at::text AS resume_updated_at
       FROM job_match_scores jms
       JOIN resumes r ON r.id = jms.resume_id
      WHERE jms.user_id = $1::uuid
        AND jms.resume_id = $2::uuid
        AND jms.job_id = $3::uuid
      ORDER BY jms.computed_at DESC
      LIMIT 1`,
    [input.userId, input.resume.id, input.jobId],
    "job_match_scores",
    input.optionalWarnings,
  )
  const score = result?.rows[0] ?? null
  if (!score) return { score: null, computedBreakdown: null, freshness: result === null ? "unavailable" : "missing" }

  const fresh = isScoreFreshForResume({
    computedAt: score.computed_at,
    resumeUpdatedAt: score.resume_updated_at,
    scoreResumeVersion: score.resume_version,
    currentResumeVersion: getResumeVersion(input.resume),
  })

  return {
    score: fresh ? score : null,
    computedBreakdown: null,
    freshness: fresh ? true : "stale",
  }
}

async function loadCachedGhostScore(
  pool: XRayQueryable,
  jobId: string,
  now: string,
  dataGaps: XRayDataGap[],
  warnings: string[],
): Promise<XRayGhostScoreRow | null> {
  const result = await optionalQuery<XRayGhostScoreRow>(
    pool,
    `SELECT risk_score, risk_level, signals, repost_count, url_status,
            has_hiring_freeze, last_scanned_at::text
       FROM ghost_job_scores
      WHERE job_id = $1::uuid
      LIMIT 1`,
    [jobId],
    "ghost_job_scores",
    warnings,
  )
  const row = result?.rows[0] ?? null
  if (!row) return null
  const ageHours = hoursSince(row.last_scanned_at, now)
  if (ageHours !== null && ageHours > GHOST_CACHE_MAX_HOURS) {
    dataGaps.push({
      id: "ghost-risk-cache-stale",
      dimension: "hiringReality",
      severity: "decision_relevant",
      label: "Ghost-risk cache is stale",
      missingField: "fresh ghost_job_scores row",
      whyNotDefaulted: "A stale URL/repost scan is not evidence that the posting is live or closed.",
      resolution: { actor: "hireoven", step: "Refresh ghost-risk scanning." },
    })
    return null
  }
  return row
}

async function loadCachedHealthScore(
  pool: XRayQueryable,
  companyId: string | null,
  warnings: string[],
): Promise<XRayHealthScoreRow | null> {
  if (!companyId) return null
  const result = await optionalQuery<XRayHealthScoreRow>(
    pool,
    `SELECT total_score, verdict, signals, events, last_computed_at::text
       FROM company_health_scores
      WHERE company_id = $1::uuid
      LIMIT 1`,
    [companyId],
    "company_health_scores",
    warnings,
  )
  return result?.rows[0] ?? null
}

async function loadRejectionPattern(
  pool: XRayQueryable,
  job: XRayJobRow,
  now: string,
  warnings: string[],
): Promise<XRayRejectionPatternRow | null> {
  if (!job.company_id) return null
  const normalizedTitle = normalizeTitle(job.normalized_title ?? job.title)
  if (!normalizedTitle) return null
  const result = await optionalQuery<XRayRejectionPatternRow>(
    pool,
    `SELECT total_submissions, referral_screen_rate, cold_apply_screen_rate,
            last_computed_at::text
       FROM rejection_patterns
      WHERE company_id = $1::uuid
        AND job_title_normalized = $2
      LIMIT 1`,
    [job.company_id, normalizedTitle],
    "rejection_patterns",
    warnings,
  )
  const row = result?.rows[0] ?? null
  if (!row) return null
  const ageDays = daysSince(row.last_computed_at, now)
  return ageDays !== null && ageDays > REJECTION_PATTERN_MAX_DAYS ? null : row
}

async function loadApplications(
  pool: XRayQueryable,
  userId: string,
  jobIds: string[],
  warnings: string[],
): Promise<XRayApplicationRow[]> {
  if (jobIds.length === 0) return []
  const result = await optionalQuery<XRayApplicationRow>(
    pool,
    `SELECT id::text, status, resume_id::text, applied_at::text, updated_at::text
       FROM job_applications
      WHERE user_id = $1::uuid
        AND job_id = ANY($2::uuid[])
      ORDER BY updated_at DESC
      LIMIT 8`,
    [userId, jobIds],
    "job_applications",
    warnings,
  )
  return result?.rows ?? []
}

async function loadCredentialDeclarations(
  pool: XRayQueryable,
  userId: string,
  warnings: string[],
): Promise<XRayCredentialDeclarationRow[]> {
  const result = await optionalQuery<XRayCredentialDeclarationRow>(
    pool,
    `SELECT id::text, user_id::text, credential_key, credential_label, held,
            expected_at::text, note, source, declared_at::text, updated_at::text
       FROM candidate_credential_declarations
      WHERE user_id = $1::uuid`,
    [userId],
    "candidate_credential_declarations",
    warnings,
  )
  return result?.rows ?? []
}

async function loadAccessRoutes(
  jobId: string,
  userId: string,
  now: string,
  sourceFacts: XRaySourceFact[],
  warnings: string[],
  loadContacts?: (input: { jobId: string; userId: string }) => Promise<NetworkingContact[]>,
): Promise<ActionableAccessRoute[]> {
  try {
    const contacts = loadContacts
      ? await loadContacts({ jobId, userId })
      : (await getJobNetworkingContacts({ jobId, userId })).contacts
    const routes = contacts.flatMap((contact) => mapNetworkingContact(contact, now))
    for (const route of routes) {
      const factId = route.sourceFactIds[0]
      if (!factId || sourceFacts.some((fact) => fact.id === factId)) continue
      sourceFacts.push({
        id: factId,
        kind: "networking_contacts",
        basis: "fact",
        confidence: route.confidence,
        key: `networking.${route.id}`,
        value: route.routeType,
        observedAt: route.observedAt,
        computedAt: null,
        explanation: "Authenticated user's reachable networking route for this employer.",
        usableBy: ["positioning"],
      })
    }
    return routes
  } catch (error) {
    if (isOptionalSchemaError(error)) {
      warnings.push("networking-contacts-unavailable")
      return []
    }
    throw error
  }
}

function mapNetworkingContact(contact: NetworkingContact, now: string): ActionableAccessRoute[] {
  const sourceFactId = `network-contact-${stableRouteId(contact.id)}`
  const common = {
    id: `route-${stableRouteId(contact.id)}`,
    routeType: routeTypeFromContact(contact.type),
    personName: contact.name || null,
    personRole: contact.role,
    personTeam: contact.team,
    relationshipContext: contact.reason,
    nextStep: nextStepForContact(contact),
    sourceFactIds: [sourceFactId],
    observedAt: null,
    freshnessDays: null,
    stale: false,
    confidence: contact.confidence,
  }

  if (contact.email) {
    return [{
      ...common,
      channel: { kind: "email", address: contact.email },
    }]
  }
  if (contact.linkedinUrl) {
    return [{
      ...common,
      channel: { kind: "linkedin_profile", url: contact.linkedinUrl },
    }]
  }
  return []
}

function routeTypeFromContact(type: NetworkingContact["type"]): ActionableAccessRoute["routeType"] {
  switch (type) {
    case "connection":
      return "direct_connection"
    case "second_degree":
      return "second_degree_connection"
    case "alumni":
      return "company_alumni"
    case "recruiter":
      return "employer_recruiter_contact"
  }
}

function nextStepForContact(contact: NetworkingContact): string {
  if (contact.type === "recruiter") return "Send a concise role-specific note to the recruiter."
  if (contact.type === "connection") return "Ask for context on the role and referral path."
  return "Ask for role context before applying cold."
}

function stableRouteId(value: string): string {
  return value.replace(/[^a-z0-9:_-]+/gi, "-").toLowerCase()
}

async function optionalQuery<T extends Record<string, unknown>>(
  pool: XRayQueryable,
  sql: string,
  values: unknown[],
  label: string,
  warnings: string[],
) {
  try {
    return await pool.query<T>(sql, values)
  } catch (error) {
    if (!isOptionalSchemaError(error)) throw error
    warnings.push(`${label}-unavailable`)
    return null
  }
}

function isOptionalSchemaError(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return code === "42P01" || code === "42703"
}

function appendRawXRaySourceFacts(raw: JsonRecord | null, facts: XRaySourceFact[]): void {
  const value = raw?.xray_source_facts
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const fact = sourceFactFromRaw(item as JsonRecord)
    if (!fact || facts.some((existing) => existing.id === fact.id)) continue
    facts.push(fact)
  }
}

function sourceFactFromRaw(record: JsonRecord): XRaySourceFact | null {
  const id = stringOrNull(record.id)
  const key = stringOrNull(record.key)
  const explanation = stringOrNull(record.explanation)
  if (!id || !key || !explanation) return null
  const kind = stringOrNull(record.kind)
  const basis = stringOrNull(record.basis)
  const confidence = stringOrNull(record.confidence)
  const usableBy = Array.isArray(record.usableBy)
    ? record.usableBy.filter((item): item is XRaySourceFact["usableBy"][number] =>
      item === "hiringReality" ||
      item === "capability" ||
      item === "evidence" ||
      item === "eligibility" ||
      item === "positioning",
    )
    : []
  if (usableBy.length === 0) return null
  return {
    id,
    kind: isSourceKind(kind) ? kind : "job_description_text",
    basis: basis === "prediction" || basis === "inference" || basis === "fact" ? basis : "fact",
    confidence: confidence === "high" || confidence === "medium" || confidence === "low" || confidence === "unknown"
      ? confidence
      : "unknown",
    key,
    value: primitiveValue(record.value),
    excerpt: stringOrNull(record.excerpt),
    observedAt: stringOrNull(record.observedAt ?? record.observed_at),
    computedAt: stringOrNull(record.computedAt ?? record.computed_at),
    sampleSize: typeof record.sampleSize === "number" ? record.sampleSize : null,
    sampleWindow: stringOrNull(record.sampleWindow ?? record.sample_window),
    explanation,
    usableBy,
    caveat: stringOrNull(record.caveat),
  }
}

function appendCompanySourceFacts(company: XRayCompanyRow | null, facts: XRaySourceFact[]): void {
  if (!company) return
  if (company.e_verify_synced_at && !facts.some((fact) => fact.id === "company-everify-source")) {
    facts.push({
      id: "company-everify-source",
      kind: "everify_source",
      basis: "fact",
      confidence: "medium",
      key: "companies.e_verify_status",
      value: stringOrNull(company.e_verify_status) ?? (company.is_e_verify === true ? "enrolled" : null),
      observedAt: stringOrNull(company.e_verify_synced_at),
      computedAt: null,
      explanation: "Stored E-Verify employer data; a source miss is not an employer refusal.",
      usableBy: ["eligibility"],
    })
  }
  if (!facts.some((fact) => fact.id === "company-row")) {
    facts.push({
      id: "company-row",
      kind: "company_row",
      basis: "fact",
      confidence: "medium",
      key: "companies.id",
      value: stringOrNull(company.id),
      observedAt: stringOrNull(company.updated_at ?? company.last_crawled_at),
      computedAt: null,
      explanation: "Stored company row joined to the evaluated job.",
      usableBy: ["hiringReality", "eligibility"],
    })
  }
}

function dedupeSourceFacts(facts: XRaySourceFact[]): XRaySourceFact[] {
  const byId = new Map<string, XRaySourceFact>()
  for (const fact of facts) {
    if (!byId.has(fact.id)) byId.set(fact.id, fact)
  }
  return [...byId.values()]
}

function hoursSince(value: string | null, now: string): number | null {
  if (!value) return null
  const start = Date.parse(value)
  const end = Date.parse(now)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Math.floor((end - start) / 3_600_000))
}

function daysSince(value: string | null, now: string): number | null {
  const hours = hoursSince(value, now)
  return hours === null ? null : Math.floor(hours / 24)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function primitiveValue(value: unknown): XRaySourceFact["value"] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value
  }
  return null
}

function isSourceKind(value: string | null): value is XRaySourceFact["kind"] {
  return Boolean(value && [
    "job_row",
    "job_description_text",
    "job_normalization",
    "ats_metadata",
    "company_row",
    "company_health",
    "company_layoffs",
    "crawl_signal",
    "ghost_score_cache",
    "url_probe",
    "match_score_cache",
    "resume_row",
    "resume_parse",
    "resume_raw_text",
    "tailor_analysis",
    "positioning_brief",
    "candidate_profile",
    "autofill_profile",
    "candidate_declaration",
    "credential_catalog",
    "networking_contacts",
    "everify_source",
    "lca_history",
    "h1b_prediction",
    "rejection_reports",
    "application_history",
    "timing_signals",
    "llm_extraction",
    "system_default",
  ].includes(value))
}
