import assert from "node:assert/strict"
import test from "node:test"
import type { QueryResult, QueryResultRow } from "pg"
import type { MatchScoreBreakdown, Resume } from "@/types"
import { getResumeVersion } from "@/lib/matching/fast-scorer"
import {
  ApplicationXRayLoadError,
  buildApplicationXRayInput,
  getApplicationXRayForUser,
  loadApplicationXRayInput,
} from "./load-input"
import type {
  JsonRecord,
  XRayAutofillRow,
  XRayCredentialDeclarationRow,
  XRayGhostScoreRow,
  XRayHealthScoreRow,
  XRayJobRow,
  XRayProfileRow,
  XRayQueryable,
  XRayRejectionPatternRow,
  XRayResumeRow,
  XRayScoreRow,
} from "./records"

const NOW = "2026-08-13T12:00:00.000Z"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const JOB_ID = "22222222-2222-4222-8222-222222222222"
const CANONICAL_ID = "33333333-3333-4333-8333-333333333333"
const RESUME_ID = "44444444-4444-4444-8444-444444444444"
const OTHER_RESUME_ID = "55555555-5555-4555-8555-555555555555"
const COMPANY_ID = "66666666-6666-4666-8666-666666666666"

test("loadApplicationXRayInput validates malformed job and resume ids", async () => {
  const pool = new FakePool()

  await assert.rejects(
    loadApplicationXRayInput({ userId: USER_ID, jobId: "bad", now: NOW, pool }),
    (error) => error instanceof ApplicationXRayLoadError && error.status === 400 && error.code === "MALFORMED_JOB_ID",
  )
  await assert.rejects(
    loadApplicationXRayInput({ userId: USER_ID, jobId: JOB_ID, resumeId: "bad", now: NOW, pool }),
    (error) => error instanceof ApplicationXRayLoadError && error.status === 400 && error.code === "MALFORMED_RESUME_ID",
  )
})

test("loadApplicationXRayInput returns 404 for missing or inaccessible jobs", async () => {
  await assert.rejects(
    loadApplicationXRayInput({ userId: USER_ID, jobId: JOB_ID, now: NOW, pool: new FakePool() }),
    (error) => error instanceof ApplicationXRayLoadError && error.status === 404 && error.code === "JOB_NOT_FOUND",
  )
})

test("explicit owned resume is selected and explicit missing resume does not fall back", async () => {
  const pool = new FakePool({
    jobs: [job()],
    resumes: [resume({ id: RESUME_ID, is_primary: false }), resume({ id: OTHER_RESUME_ID, is_primary: true })],
    profile: profile(),
  })

  const loaded = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    resumeId: RESUME_ID,
    now: NOW,
    pool,
    loadNetworkingContacts: async () => [],
  })
  assert.equal(loaded.resume?.id, RESUME_ID)

  await assert.rejects(
    loadApplicationXRayInput({
      userId: USER_ID,
      jobId: JOB_ID,
      resumeId: "77777777-7777-4777-8777-777777777777",
      now: NOW,
      pool,
      loadNetworkingContacts: async () => [],
    }),
    (error) => error instanceof ApplicationXRayLoadError && error.status === 404 && error.code === "RESUME_NOT_FOUND",
  )
})

test("default resume is used first, then unusable default falls back to primary latest", async () => {
  const defaultResume = resume({ id: RESUME_ID, is_primary: false })
  const primaryResume = resume({ id: OTHER_RESUME_ID, is_primary: true, updated_at: "2026-08-13T11:00:00.000Z" })
  const pool = new FakePool({
    jobs: [job()],
    resumes: [defaultResume, primaryResume],
    profile: profile({ default_resume_id: RESUME_ID }),
  })

  const loadedDefault = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool,
    loadNetworkingContacts: async () => [],
  })
  assert.equal(loadedDefault.resume?.id, RESUME_ID)

  defaultResume.parse_status = "failed"
  const loadedFallback = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool,
    loadNetworkingContacts: async () => [],
  })
  assert.equal(loadedFallback.resume?.id, OTHER_RESUME_ID)
})

test("missing default_resume_id column degrades and primary resume is still used", async () => {
  const pool = new FakePool({
    jobs: [job()],
    resumes: [resume()],
    profile: profile(),
    optionalFailures: new Set(["profiles.default_resume_id"]),
  })

  const loaded = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool,
    loadNetworkingContacts: async () => [],
  })

  assert.equal(loaded.resume?.id, RESUME_ID)
  assert.ok(loaded.optionalWarnings.includes("profiles.default_resume_id-unavailable"))
})

test("no resume remains valid input and blocks only candidate document dimensions", async () => {
  const loaded = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({ jobs: [job()], profile: profile() }),
    loadNetworkingContacts: async () => [],
  })
  const input = buildApplicationXRayInput(loaded)

  assert.equal(input.resume, null)
  assert.equal(input.capability.careerFitScore, null)
})

test("canonical candidates are bounded to three hops and closed jobs still reach the core", async () => {
  const rows = [
    job({ id: JOB_ID, duplicate_of_id: "30000000-0000-4000-8000-000000000001", is_active: false, closed_at: "2026-08-12T00:00:00.000Z" }),
    job({ id: "30000000-0000-4000-8000-000000000001", duplicate_of_id: "30000000-0000-4000-8000-000000000002" }),
    job({ id: "30000000-0000-4000-8000-000000000002", duplicate_of_id: "30000000-0000-4000-8000-000000000003" }),
    job({ id: "30000000-0000-4000-8000-000000000003", duplicate_of_id: "30000000-0000-4000-8000-000000000004" }),
    job({ id: "30000000-0000-4000-8000-000000000004", title: "Should not load" }),
  ]
  const loaded = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({ jobs: rows, resumes: [resume()], profile: profile() }),
    loadNetworkingContacts: async () => [],
  })
  const input = buildApplicationXRayInput(loaded)

  assert.equal(input.jobRecords.length, 4)
  assert.equal(input.jobRecords[0]?.availability.isActive, false)
  assert.equal(input.jobRecords.some((row) => row.id === "30000000-0000-4000-8000-000000000004"), false)
})

test("canonical cycle is supplied to core for cycle detection", async () => {
  const loaded = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [
        job({ id: JOB_ID, duplicate_of_id: CANONICAL_ID }),
        job({ id: CANONICAL_ID, duplicate_of_id: JOB_ID }),
      ],
      resumes: [resume()],
      profile: profile(),
    }),
    loadNetworkingContacts: async () => [],
  })
  const payload = await getApplicationXRayForUser({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [
        job({ id: JOB_ID, duplicate_of_id: CANONICAL_ID }),
        job({ id: CANONICAL_ID, duplicate_of_id: JOB_ID }),
      ],
      resumes: [resume()],
      profile: profile(),
    }),
    loadNetworkingContacts: async () => [],
  })

  assert.equal(loaded.jobRows.length, 2)
  assert.equal(payload.xray.canonical.outcome, "unresolved_canonical_invalid")
})

test("fresh careerFit is used while stale match scores are degraded to unknown", async () => {
  const freshPool = new FakePool({
    jobs: [job()],
    resumes: [resume()],
    profile: profile(),
    matchScores: [scoreRow({ overall_score: 99, careerFitScore: 31 })],
  })
  const fresh = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: freshPool,
    loadNetworkingContacts: async () => [],
  }))
  assert.equal(fresh.capability.careerFitScore, 31)

  const stale = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job()],
      resumes: [resume()],
      profile: profile(),
      matchScores: [scoreRow({ computed_at: "2026-08-12T00:00:00.000Z", careerFitScore: 88 })],
    }),
    loadNetworkingContacts: async () => [],
  }))
  assert.equal(stale.capability.careerFitScore, null)
  assert.ok(stale.dataGaps?.some((gap) => gap.id === "career-fit-score-stale"))
})

test("OPT current authorization remains YES while future employer actions remain separate", async () => {
  const input = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job()],
      resumes: [resume()],
      profile: profile({ visa_status: "opt", opt_end_date: "2026-12-31" }),
    }),
    loadNetworkingContacts: async () => [],
  }))

  assert.equal(input.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction, "YES")
  assert.ok(input.eligibility.candidate.futureEmployerActions.some((action) => action.type === "STEM_OPT_EVERIFY_PARTICIPATION"))
})

test("H-1B at another employer requires target-employer action", async () => {
  const input = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job()],
      resumes: [resume()],
      profile: profile({ visa_status: "h1b" }),
    }),
    loadNetworkingContacts: async () => [],
  }))

  assert.equal(input.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction, "NEEDS_EMPLOYER_ACTION")
  assert.equal(input.eligibility.candidate.futureEmployerActions[0]?.type, "H1B_TRANSFER")
})

test("E-Verify source miss is distinct from confirmed employer refusal", async () => {
  const input = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job({ company: company({ is_e_verify: false, e_verify_status: null, e_verify_synced_at: "2026-08-10T00:00:00.000Z" }) })],
      resumes: [resume()],
      profile: profile({ visa_status: "stem_opt" }),
    }),
    loadNetworkingContacts: async () => [],
  }))

  assert.equal(input.eligibility.sponsorshipHistory?.eVerify.participation, "NOT_FOUND_IN_SOURCE")
  assert.equal(input.eligibility.employerActionFeasibility[0]?.status, "NOT_FOUND")
})

test("required employer action refusal can drive SKIP only with candidate requirement and cited employer refusal", async () => {
  const refused = await getApplicationXRayForUser({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job({
        raw_data: {
          xray_employer_action_feasibility: [{
            actionType: "H1B_TRANSFER",
            status: "REFUSED_CONFIRMED",
            employerStatementExcerpt: "We cannot do an H-1B transfer for this role.",
            candidateRequiresAction: true,
            sourceFactIds: ["employer-refusal"],
            confidence: "medium",
          }],
          xray_source_facts: [{
            id: "employer-refusal",
            kind: "job_description_text",
            basis: "fact",
            confidence: "medium",
            key: "raw_data.employer_refusal",
            value: true,
            excerpt: "We cannot do an H-1B transfer for this role.",
            explanation: "Employer statement captured in stored posting data.",
            usableBy: ["eligibility"],
          }],
        },
      })],
      resumes: [resume()],
      profile: profile({ visa_status: "h1b" }),
      matchScores: [scoreRow({ careerFitScore: 85 })],
    }),
    loadNetworkingContacts: async () => [],
  })
  assert.equal(refused.xray.finalAction, "SKIP")
  assert.ok(refused.xray.actions.length > 0)

  const uncited = await getApplicationXRayForUser({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job({
        raw_data: {
          xray_employer_action_feasibility: [{
            actionType: "H1B_TRANSFER",
            status: "REFUSED_CONFIRMED",
            employerStatementExcerpt: "We cannot do an H-1B transfer for this role.",
            candidateRequiresAction: false,
            sourceFactIds: ["employer-refusal"],
            confidence: "medium",
          }],
        },
      })],
      resumes: [resume()],
      profile: profile({ visa_status: "h1b" }),
      matchScores: [scoreRow({ careerFitScore: 85 })],
    }),
    loadNetworkingContacts: async () => [],
  })
  assert.notEqual(uncited.xray.finalAction, "SKIP")
})

test("generic no-sponsorship language remains scope ambiguous", async () => {
  const input = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job({ description: `${longDescription()} We do not sponsor visas for this position.` })],
      resumes: [resume()],
      profile: profile({ visa_status: "opt", opt_end_date: "2026-12-31" }),
    }),
    loadNetworkingContacts: async () => [],
  }))

  assert.equal(input.eligibility.postingRequirements[0]?.category, "SPONSORSHIP_SCOPE_AMBIGUOUS")
})

test("referral statistics alone do not create FIND_ACCESS", async () => {
  const payload = await getApplicationXRayForUser({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job()],
      resumes: [resume()],
      profile: profile({ visa_status: "citizen" }),
      matchScores: [scoreRow({ careerFitScore: 82 })],
      rejectionPattern: { total_submissions: 40, referral_screen_rate: 0.7, cold_apply_screen_rate: 0.2, last_computed_at: NOW },
    }),
    loadNetworkingContacts: async () => [],
  })

  assert.equal(payload.xray.referralAdvisory?.gatesFinalAction, false)
  assert.notEqual(payload.xray.finalAction, "FIND_ACCESS")
})

test("rejection advisory requires sample size and freshness", async () => {
  const lowSample = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job()],
      resumes: [resume()],
      profile: profile(),
      rejectionPattern: { total_submissions: 9, referral_screen_rate: 0.7, cold_apply_screen_rate: 0.2, last_computed_at: NOW },
    }),
    loadNetworkingContacts: async () => [],
  }))
  assert.equal(lowSample.referralAdvisory, null)

  const stalePattern = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job()],
      resumes: [resume()],
      profile: profile(),
      rejectionPattern: { total_submissions: 40, referral_screen_rate: 0.7, cold_apply_screen_rate: 0.2, last_computed_at: "2025-01-01T00:00:00.000Z" },
    }),
    loadNetworkingContacts: async () => [],
  }))
  assert.equal(stalePattern.referralAdvisory, null)
})

test("networking contacts must have a reachable channel", async () => {
  const withoutChannel = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({ jobs: [job()], resumes: [resume()], profile: profile() }),
    loadNetworkingContacts: async () => [{
      id: "c1",
      type: "alumni",
      name: "Alumni",
      role: "Engineer",
      team: null,
      company: "Acme",
      confidence: "high",
      reason: "Visible alumni.",
      source: "cohort_members",
      linkedinUrl: null,
      email: null,
    }],
  }))
  assert.equal(withoutChannel.accessRoutes.length, 0)

  const withEmail = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({ jobs: [job()], resumes: [resume()], profile: profile() }),
    loadNetworkingContacts: async () => [{
      id: "r1",
      type: "recruiter",
      name: "Recruiter",
      role: "Recruiter",
      team: "Recruiting",
      company: "Acme",
      confidence: "medium",
      reason: "Active hiring contact.",
      source: "employer_cohort_requests",
      linkedinUrl: null,
      email: "recruiting@example.com",
    }],
  }))
  assert.equal(withEmail.accessRoutes.length, 1)
  assert.equal(withEmail.accessRoutes[0]?.channel.kind, "email")
  assert.ok(withEmail.sourceFacts?.some((fact) => fact.kind === "networking_contacts"))
})

test("stale ghost cache and optional declaration table misses degrade without failure", async () => {
  const loaded = await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job()],
      resumes: [resume()],
      profile: profile(),
      ghost: {
        risk_score: 20,
        risk_level: "low",
        signals: {},
        repost_count: 0,
        url_status: "ok",
        has_hiring_freeze: false,
        last_scanned_at: "2026-08-10T00:00:00.000Z",
      },
      optionalFailures: new Set(["candidate_credential_declarations"]),
    }),
    loadNetworkingContacts: async () => [],
  })
  const input = buildApplicationXRayInput(loaded)

  assert.equal(input.hiringReality.ghostRisk.band, "unknown")
  assert.ok(input.dataGaps?.some((gap) => gap.id === "ghost-risk-cache-stale"))
  assert.ok(loaded.optionalWarnings.includes("candidate_credential_declarations-unavailable"))
})

test("credential declarations can establish absence without treating NOT_FOUND as person absence", async () => {
  const noDeclaration = buildApplicationXRayInput(await loadApplicationXRayInput({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job({ description: `${longDescription()} Active CPA license required.` })],
      resumes: [resume({ raw_text: "Software engineer with backend systems experience." })],
      profile: profile(),
    }),
    loadNetworkingContacts: async () => [],
  }))
  assert.equal(noDeclaration.capability.requirements[0]?.presence, "NOT_FOUND")
  assert.equal(noDeclaration.capability.requirements[0]?.supportsHardSkip, false)

  const declaredAbsent = await getApplicationXRayForUser({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job({ description: `${longDescription()} Active CPA license required.` })],
      resumes: [resume({ raw_text: "Software engineer with backend systems experience." })],
      profile: profile({ visa_status: "citizen" }),
      matchScores: [scoreRow({ careerFitScore: 82 })],
      declarations: [{
        id: "decl-1",
        user_id: USER_ID,
        credential_key: "cpa",
        credential_label: "CPA",
        held: false,
        expected_at: null,
        note: null,
        source: "prompt",
        declared_at: NOW,
        updated_at: NOW,
      }],
    }),
    loadNetworkingContacts: async () => [],
  })
  assert.equal(declaredAbsent.xray.capability.requirements[0]?.presence, "ABSENT_CONFIRMED")
  assert.equal(declaredAbsent.xray.capability.requirements[0]?.supportsHardSkip, true)
})

test("sanitized X-Ray output truncates excerpts and strips accidental raw keys", async () => {
  const payload = await getApplicationXRayForUser({
    userId: USER_ID,
    jobId: JOB_ID,
    now: NOW,
    pool: new FakePool({
      jobs: [job({
        raw_data: {
          xray_source_facts: [{
            id: "long-fact",
            kind: "job_description_text",
            basis: "fact",
            confidence: "high",
            key: "jobs.description.long",
            value: true,
            excerpt: "x".repeat(800),
            explanation: "Long stored excerpt.",
            usableBy: ["hiringReality"],
            raw_data: { secret: true },
          }],
        },
      })],
      resumes: [resume()],
      profile: profile(),
    }),
    loadNetworkingContacts: async () => [],
  })
  const fact = payload.xray.sourceFacts.find((item) => item.id === "long-fact")
  assert.ok(fact)
  assert.ok((fact.excerpt?.length ?? 0) <= 360)
  assert.equal("raw_data" in (fact as unknown as JsonRecord), false)
})

class FakePool implements XRayQueryable {
  readonly queries: string[] = []

  constructor(private readonly data: {
    jobs?: XRayJobRow[]
    profile?: XRayProfileRow | null
    autofill?: XRayAutofillRow | null
    resumes?: XRayResumeRow[]
    matchScores?: XRayScoreRow[]
    ghost?: XRayGhostScoreRow | null
    health?: XRayHealthScoreRow | null
    rejectionPattern?: XRayRejectionPatternRow | null
    declarations?: XRayCredentialDeclarationRow[]
    optionalFailures?: Set<string>
  } = {}) {}

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push(text)
    const sql = text.replace(/\s+/g, " ")

    if (sql.includes("FROM jobs j")) {
      return result(this.visibleJob(String(values[0])) as T | null)
    }
    if (sql.includes("SELECT * FROM profiles")) {
      return result((this.data.profile ?? null) as T | null)
    }
    if (sql.includes("default_resume_id")) {
      this.maybeThrow("profiles.default_resume_id")
      return result({ default_resume_id: this.data.profile?.default_resume_id ?? null } as unknown as T)
    }
    if (sql.includes("FROM autofill_profiles")) {
      this.maybeThrow("autofill_profiles")
      return result((this.data.autofill ?? null) as T | null)
    }
    if (sql.includes("FROM resumes") && sql.includes("WHERE id = $1::uuid")) {
      const resume = (this.data.resumes ?? []).find((item) => item.id === values[0] && item.user_id === values[1])
      return result((resume ?? null) as T | null)
    }
    if (sql.includes("FROM resumes") && sql.includes("archived_at IS NULL")) {
      this.maybeThrow("resumes.archived_at")
      return result((this.latestResume() ?? null) as unknown as T | null)
    }
    if (sql.includes("FROM resumes")) {
      return result((this.latestResume() ?? null) as unknown as T | null)
    }
    if (sql.includes("FROM job_match_scores")) {
      this.maybeThrow("job_match_scores")
      const score = (this.data.matchScores ?? []).find((item) => item.user_id === values[0] && item.resume_id === values[1] && item.job_id === values[2])
      return result((score ?? null) as T | null)
    }
    if (sql.includes("FROM ghost_job_scores")) {
      this.maybeThrow("ghost_job_scores")
      return result((this.data.ghost ?? null) as T | null)
    }
    if (sql.includes("FROM company_health_scores")) {
      this.maybeThrow("company_health_scores")
      return result((this.data.health ?? null) as T | null)
    }
    if (sql.includes("FROM rejection_patterns")) {
      this.maybeThrow("rejection_patterns")
      return result((this.data.rejectionPattern ?? null) as T | null)
    }
    if (sql.includes("FROM job_applications")) {
      this.maybeThrow("job_applications")
      return results<T>([])
    }
    if (sql.includes("FROM candidate_credential_declarations")) {
      this.maybeThrow("candidate_credential_declarations")
      return results((this.data.declarations ?? []) as unknown as T[])
    }

    throw new Error(`Unhandled SQL: ${sql}`)
  }

  private visibleJob(id: string) {
    const row = (this.data.jobs ?? []).find((item) => item.id === id)
    if (!row) return null
    return row.publication_status === "hidden_invalid" || row.publication_status === "hidden_low_quality"
      ? null
      : row
  }

  private latestResume() {
    return [...(this.data.resumes ?? [])]
      .filter((item) => item.user_id === USER_ID && item.parse_status === "complete")
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || b.updated_at.localeCompare(a.updated_at))[0] ?? null
  }

  private maybeThrow(label: string) {
    if (!this.data.optionalFailures?.has(label)) return
    throw Object.assign(new Error(label), { code: "42703" })
  }
}

function result<T extends QueryResultRow>(row: T | null): QueryResult<T> {
  return results(row ? [row] : [])
}

function results<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] }
}

function company(overrides: Partial<XRayJobRow["company"]> = {}): XRayJobRow["company"] {
  return {
    id: COMPANY_ID,
    name: "Acme Corp",
    domain: "example.com",
    ats_type: "greenhouse",
    direct_ats_provider: null,
    direct_ats_identifier: null,
    last_crawled_at: "2026-08-13T00:00:00.000Z",
    median_days_open: 23,
    time_to_fill_sample: 12,
    sponsors_h1b: null,
    h1b_sponsor_count_1yr: null,
    h1b_sponsor_count_3yr: null,
    is_e_verify: null,
    e_verify_status: null,
    e_verify_synced_at: null,
    updated_at: "2026-08-13T00:00:00.000Z",
    ...overrides,
  }
}

function job(overrides: Partial<XRayJobRow> = {}): XRayJobRow {
  return {
    id: JOB_ID,
    company_id: COMPANY_ID,
    duplicate_of_id: null,
    title: "Senior Software Engineer",
    normalized_title: "software engineer",
    description: longDescription(),
    apply_url: "https://example.com/jobs/1",
    content_hash: "hash-1",
    raw_data: null,
    skills: ["TypeScript", "PostgreSQL"],
    source_ats: "greenhouse",
    source_ats_slug: "greenhouse",
    external_id: "REQ-1",
    is_active: true,
    publication_status: "visible_enriched",
    closed_at: null,
    first_detected_at: "2026-08-01T00:00:00.000Z",
    last_seen_at: "2026-08-13T00:00:00.000Z",
    posted_at: "2026-08-01T00:00:00.000Z",
    is_remote: true,
    location: "Remote, United States",
    employment_type: "fulltime",
    seniority_level: "senior",
    sponsors_h1b: null,
    requires_authorization: false,
    visa_language_detected: null,
    h1b_prediction: null,
    h1b_prediction_at: null,
    company: company(),
    ...overrides,
  }
}

function profile(overrides: Partial<XRayProfileRow> = {}): XRayProfileRow {
  return {
    id: USER_ID,
    email: "user@example.com",
    full_name: "User Example",
    avatar_url: null,
    desired_roles: ["Software Engineer"],
    desired_locations: ["Remote"],
    desired_seniority: ["senior"],
    desired_employment_types: ["fulltime"],
    seniority_level: "senior",
    top_skills: ["TypeScript"],
    remote_only: true,
    is_international: false,
    visa_status: null,
    opt_end_date: null,
    needs_sponsorship: false,
    alert_frequency: "weekly",
    email_alerts: true,
    push_alerts: false,
    is_admin: false,
    last_active_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function resume(overrides: Partial<Resume> = {}): XRayResumeRow {
  return {
    id: RESUME_ID,
    user_id: USER_ID,
    file_name: "resume.pdf",
    name: "Resume",
    file_url: "s3://resume",
    storage_path: "resume.pdf",
    file_size: 1000,
    file_type: "pdf",
    is_primary: true,
    parse_status: "complete",
    parse_error: null,
    full_name: "User Example",
    email: "user@example.com",
    phone: null,
    location: "Austin, TX",
    linkedin_url: null,
    portfolio_url: null,
    github_url: null,
    summary: "Senior software engineer focused on TypeScript and PostgreSQL.",
    work_experience: [{
      company: "Previous Co",
      title: "Software Engineer",
      start_date: "2021",
      end_date: "2026",
      is_current: true,
      description: "Built TypeScript services with PostgreSQL and measurable uptime improvements.",
      achievements: ["Improved API latency by 30%."],
    }],
    education: [],
    skills: { technical: ["TypeScript", "PostgreSQL"], soft: [], languages: [], certifications: [] },
    projects: [],
    certifications: [],
    seniority_level: "senior",
    years_of_experience: 5,
    primary_role: "Software Engineer",
    industries: ["software"],
    top_skills: ["TypeScript", "PostgreSQL"],
    additional_sections: [],
    resume_score: 85,
    ats_score: 80,
    raw_text: "Senior software engineer. TypeScript PostgreSQL APIs. Improved API latency by 30%.",
    archived_at: null,
    content_modified: false,
    parent_resume_id: null,
    tailored_for_job_id: null,
    tailored_for_company: null,
    tailored_for_role: null,
    target_field: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-13T10:00:00.000Z",
    ...overrides,
  }
}

function scoreRow(overrides: Partial<XRayScoreRow & { careerFitScore: number }> = {}): XRayScoreRow {
  const baseResume = resume()
  const careerFitScore = overrides.careerFitScore ?? 85
  const breakdown: MatchScoreBreakdown = {
    overallScore: overrides.overall_score ?? 85,
    skillsScore: 85,
    experienceScore: 80,
    seniorityScore: 80,
    roleFamilyScore: 90,
    roleFamily: "tech",
    candidateRoleFamilies: ["tech"],
    careerFit: {
      atsScreenScore: careerFitScore,
      careerFitScore,
      relevantYears: 5,
      totalYears: 5,
      requiredYears: 4,
      relevantYearsRatio: 1.25,
      label: careerFitScore >= 80 ? "ats_ready" : "bridge_first",
      recommendation: "Use verified engineering evidence.",
      evidence: ["Relevant software engineering experience."],
    },
    domainScore: 80,
    semanticScore: 80,
    certificationScore: 80,
    locationScore: 100,
    employmentTypeScore: 100,
    sponsorshipScore: 50,
    visaFitScore: 50,
    freshnessScore: 100,
    matchedSkills: ["TypeScript"],
    missingSkills: [],
    skillScores: [{ skill: "TypeScript", score: 1 }],
    totalRequiredSkills: 1,
    scoreMethod: "fast",
    confidence: "high",
    concerns: [],
    computedAt: NOW,
  }
  const row: XRayScoreRow = {
    id: "score-1",
    user_id: USER_ID,
    resume_id: RESUME_ID,
    job_id: JOB_ID,
    overall_score: 85,
    skills_score: 85,
    seniority_score: 80,
    education_score: 80,
    role_fit_score: 80,
    location_score: 100,
    employment_type_score: 100,
    sponsorship_score: 50,
    domain_score: 80,
    is_seniority_match: true,
    is_education_match: true,
    is_role_fit_match: true,
    is_location_match: true,
    is_employment_type_match: true,
    is_sponsorship_compatible: true,
    matching_skills_count: 1,
    total_required_skills: 1,
    skills_match_rate: 1,
    score_method: "fast",
    score_breakdown: breakdown,
    computed_at: NOW,
    resume_version: getResumeVersion(baseResume),
    resume_updated_at: baseResume.updated_at,
    ...overrides,
  }
  if (overrides.careerFitScore !== undefined && row.score_breakdown?.careerFit) {
    row.score_breakdown = {
      ...row.score_breakdown,
      careerFit: {
        ...row.score_breakdown.careerFit,
        careerFitScore: overrides.careerFitScore,
        atsScreenScore: overrides.careerFitScore,
      },
    }
  }
  return row
}

function longDescription() {
  return [
    "We are hiring a Senior Software Engineer to build resilient product systems.",
    "The role requires TypeScript, PostgreSQL, API design, production ownership, and clear communication.",
    "You will work with product and infrastructure teams to ship reliable customer-facing services.",
  ].join(" ")
}
