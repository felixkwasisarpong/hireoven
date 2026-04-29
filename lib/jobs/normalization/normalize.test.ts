import test from "node:test"
import assert from "node:assert/strict"
import { extractCanonicalSections } from "@/lib/jobs/normalization/sections"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization/normalize"
import { resolveJobCardView } from "@/lib/jobs/normalization/read-model"
import { extractSkillsFromText } from "@/lib/jobs/text-normalizer"
import {
  adaptRawCrawlerJob,
  detectSourceAdapter,
} from "@/lib/jobs/normalization/source-adapters"

test("extractCanonicalSections maps heading variants to canonical buckets", () => {
  const sections = extractCanonicalSections({
    adapter: "generic_html",
    description: `
About the Role:
We are building the hiring platform for international candidates.

What you'll do:
- Build frontend features in React and TypeScript
- Partner with product and design

Minimum qualifications:
- 4+ years of software engineering experience
- Strong understanding of APIs

Preferred qualifications:
- Experience with Rust

Benefits:
- Health, dental, and vision insurance
- 401(k) with employer match
`,
  })

  assert.ok(sections.about_role.items.length > 0)
  assert.ok(sections.responsibilities.items.length >= 2)
  assert.ok(sections.requirements.items.length >= 2)
  assert.ok(sections.preferred_qualifications.items.length > 0)
  assert.ok(sections.benefits.items.length > 0)
})

test("extractCanonicalSections uses heuristics/fallback for unstructured blobs", () => {
  const sections = extractCanonicalSections({
    adapter: "generic_html",
    description:
      "You will build and ship backend systems with Node and PostgreSQL. Must have 5 years of experience with distributed systems and strong communication skills. We offer health benefits, paid time off, and parental leave. We are a globally distributed team serving enterprise customers.",
  })

  assert.ok(sections.responsibilities.items.length > 0)
  assert.ok(sections.requirements.items.length > 0)
  assert.ok(sections.benefits.items.length > 0)
  assert.ok(sections.company_info.items.length > 0 || sections.about_role.items.length > 0)
})

test("extractCanonicalSections keeps about/requirements/preferred boundaries precise", () => {
  const sections = extractCanonicalSections({
    adapter: "generic_html",
    description:
      "About the role: Join our platform team building global developer infrastructure. Responsibilities: Build and operate distributed services. Partner with product and security teams. Basic Qualifications: 7+ years of software engineering experience. Strong Java or Python proficiency. Preferred Qualifications: Experience with Kubernetes and Kafka. Nice to have experience in fintech. Benefits: Health, dental, and vision coverage.",
  })

  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const about = sections.about_role.items.map(normalize)
  const responsibilities = sections.responsibilities.items.map(normalize)
  const requirements = sections.requirements.items.map(normalize)
  const preferred = sections.preferred_qualifications.items.map(normalize)

  assert.ok(about.length > 0)
  assert.ok(about.every((item) => !/qualifications|requirements|responsibilit/.test(item)))
  assert.ok(responsibilities.length > 0)
  assert.ok(
    responsibilities.every((item) => !/minimum qualifications|basic qualifications|preferred qualifications/.test(item))
  )
  assert.ok(requirements.some((item) => /7 years|java|python/.test(item)))
  assert.ok(preferred.some((item) => /kubernetes|kafka|nice to have/.test(item)))
  assert.ok(about.every((item) => !responsibilities.includes(item)))
})

test("extractCanonicalSections handles run-on inline headings without section leakage", () => {
  const sections = extractCanonicalSections({
    adapter: "generic_html",
    description:
      "Who we are Stripe is a financial infrastructure platform for businesses. About the team Product Sales is a team of deep functional and technical specialists. What you'll do As a Product Account Executive, you will own and drive complex opportunities. Responsibilities - Own and close strategic opportunities end-to-end. - Develop and execute go-to-market strategies in collaboration with Product and Marketing. Who you are We are looking for someone who meets the minimum requirements. Minimum requirements - 7+ years of enterprise technology sales experience. - Deep expertise in consultative and solution-based selling. Additional benefits include: equity, 401(k), and medical coverage. Office locations New York or Seattle. Job type Full time. Apply for this role today.",
  })

  assert.ok(sections.about_role.items.some((item) => /product sales is a team/i.test(item)))
  assert.ok(sections.responsibilities.items.some((item) => /own and close strategic opportunities/i.test(item)))
  assert.ok(
    sections.responsibilities.items.every(
      (item) => !/^about the team\b/i.test(item) && !/^what you(?:'|’)ll do\b/i.test(item)
    )
  )
  assert.ok(sections.requirements.items.some((item) => /7\+ years|consultative/i.test(item)))
  assert.ok(
    sections.benefits.items.every(
      (item) => !/office locations|job type|apply for this role/i.test(item)
    )
  )
  assert.ok(
    sections.application_info.items.some((item) =>
      /office locations|job type|apply for this role/i.test(item)
    )
  )
})

test("normalizeCrawlerJobForPersistence derives canonical fields with provenance", () => {
  const result = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: "greenhouse:123",
      title: "Senior Software Engineer",
      url: "https://boards.greenhouse.io/example/jobs/123",
      location: "San Francisco, CA",
      postedAt: "2026-04-20T13:00:00.000Z",
      description: `
Compensation:
$160k - $210k per year

Responsibilities:
- Build scalable services
- Mentor engineers

Requirements:
- 6+ years of experience

Work authorization:
Visa sponsorship available for qualified candidates.
`,
    },
    crawledAtIso: "2026-04-22T01:00:00.000Z",
  })

  assert.equal(result.canonical.source.adapter, "greenhouse")
  assert.equal(result.nextColumns.sponsors_h1b, true)
  assert.equal(result.nextColumns.salary_min, 160000)
  assert.equal(result.nextColumns.salary_max, 210000)
  assert.ok(result.canonical.sections.responsibilities.items.length > 0)
  assert.ok(result.canonical.sections.requirements.items.length > 0)
  assert.ok(result.pageView.sections.compensation.items.length > 0)
  assert.ok(result.canonical.validation.confidence_score > 0)
})

test("resolveJobCardView infers salary from description when columns are empty", () => {
  const card = resolveJobCardView({
    title: "Backend Engineer",
    location: "Remote",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    employment_type: "fulltime",
    seniority_level: "mid",
    description: "Compensation: $150k - $190k per year plus bonus.",
    skills: [],
    sponsors_h1b: null,
    requires_authorization: false,
    sponsorship_score: 0,
    raw_data: null,
  })

  assert.equal(card.salary_label, "$150k-$190k")
})

test("extractSkillsFromText only tags go when language context exists", () => {
  const nonLanguage = extractSkillsFromText(
    "Account Executive",
    "Serve as the go-to expert and build go-to-market plans for enterprise customers."
  )
  assert.equal(nonLanguage.includes("go"), false)

  const language = extractSkillsFromText(
    "Backend Engineer",
    "Experience with Go and Rust. Build high-throughput Golang services."
  )
  assert.equal(language.includes("Go"), true)
})

test("detectSourceAdapter recognizes ats-prefixed external ids", () => {
  assert.equal(detectSourceAdapter({ externalId: "greenhouse-embedded:1234" }), "greenhouse")
  assert.equal(detectSourceAdapter({ externalId: "oracle:abc" }), "oracle")
  assert.equal(detectSourceAdapter({ externalId: "phenom:abc" }), "phenom")
  assert.equal(detectSourceAdapter({ externalId: "google:abc" }), "google")
  assert.equal(detectSourceAdapter({ externalId: "jobvite:abc" }), "jobvite")
  assert.equal(detectSourceAdapter({ applyUrl: "https://jobs.jobvite.com/acme/job/oXyz" }), "jobvite")
})

test("adaptRawCrawlerJob extracts structured sections for ats sources", () => {
  const adapted = adaptRawCrawlerJob({
    externalId: "workday:careers:job_91",
    title: "Senior Platform Engineer",
    url: "https://example.wd1.myworkdayjobs.com/en-US/careers/job/Senior-Platform-Engineer_R-91",
    description:
      "Overview We build critical platform systems. Responsibilities - Build and operate distributed services. Basic Qualifications - 5+ years of backend engineering experience. Preferred Qualifications - Experience with Kafka and Kubernetes. Benefits - Medical, dental, and vision coverage.",
    location: "Austin, TX",
  })

  assert.equal(adapted.adapter, "workday")
  assert.ok((adapted.structuredSections.about_role ?? []).length > 0)
  assert.ok((adapted.structuredSections.responsibilities ?? []).length > 0)
  assert.ok((adapted.structuredSections.requirements ?? []).length > 0)
  assert.ok((adapted.structuredSections.preferred_qualifications ?? []).length > 0)
  assert.ok((adapted.structuredSections.benefits ?? []).length > 0)
})

test("adaptRawCrawlerJob keeps generic sources unstructured", () => {
  const adapted = adaptRawCrawlerJob({
    externalId: "url:custom-123",
    title: "Backend Engineer",
    url: "https://jobs.example.com/openings/backend-engineer",
    description:
      "Responsibilities: Build APIs. Requirements: 4+ years of experience with distributed systems.",
    location: "Remote",
  })

  assert.equal(adapted.adapter, "generic_html")
  assert.equal((adapted.structuredSections.responsibilities ?? []).length, 0)
  assert.equal((adapted.structuredSections.requirements ?? []).length, 0)
})

test("extractCanonicalSections does not leak nav/auth chrome into sections", () => {
  const description = [
    "Skip to main content",
    "Sign in",
    "Sign in to create job alert",
    "Apply Now",
    "Save this job",
    "Cookie policy",
    "About the role",
    "We are building hiring infrastructure for international candidates worldwide.",
    "Responsibilities:",
    "- Build distributed backend services.",
    "- Partner with product, design, and security teams.",
    "Requirements:",
    "- 5+ years of backend engineering experience.",
    "- Strong fluency with TypeScript or Go.",
    "Related jobs",
    "Similar jobs",
    "Back to results",
  ].join("\n")

  const sections = extractCanonicalSections({
    adapter: "generic_html",
    description,
  })

  const allItems = Object.values(sections).flatMap((section) => section.items)
  for (const phrase of [
    "skip to main content",
    "sign in",
    "sign in to create job alert",
    "apply now",
    "save this job",
    "cookie policy",
    "related jobs",
    "similar jobs",
    "back to results",
  ]) {
    assert.ok(
      allItems.every((item) => !item.toLowerCase().includes(phrase)),
      `chrome phrase "${phrase}" leaked into sections: ${JSON.stringify(allItems)}`
    )
  }

  assert.ok(sections.responsibilities.items.some((item) => /distributed backend services/i.test(item)))
  assert.ok(sections.requirements.items.some((item) => /5\+ years/i.test(item)))
})

test("normalizeCrawlerJobForPersistence keeps chrome-laden inputs out of all sections", () => {
  const result = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: "url:chrome-1",
      title: "Senior Backend Engineer",
      url: "https://jobs.example.com/openings/senior-backend-engineer",
      description: [
        "Skip to main content",
        "Sign in to create job alert",
        "Apply now",
        "About the role:",
        "We build the financial platform for global businesses.",
        "Responsibilities:",
        "- Own and operate critical APIs.",
        "- Mentor mid-level engineers.",
        "Requirements:",
        "- 6+ years of backend engineering experience.",
        "- Strong fluency in Go or Python.",
        "Cookie Policy",
        "Privacy Policy",
        "Related jobs",
      ].join("\n"),
      location: "San Francisco, CA",
    },
    crawledAtIso: "2026-04-28T00:00:00.000Z",
  })

  const allItems = Object.values(result.canonical.sections).flatMap((section) => section.items)
  for (const phrase of [
    "skip to main content",
    "sign in to create job alert",
    "cookie policy",
    "privacy policy",
    "related jobs",
  ]) {
    assert.ok(
      allItems.every((item) => !item.toLowerCase().includes(phrase)),
      `phrase "${phrase}" leaked into normalized sections`
    )
  }
})

test("adaptRawCrawlerJob trims crawler CTA noise from location", () => {
  const adapted = adaptRawCrawlerJob({
    externalId: "url:pyramid-1",
    title: "AI Data Engineer",
    url: "https://jobs.example.com/openings/ai-data-engineer",
    description: "Contract role for AI data engineering projects.",
    location: "U.S(Remote). Please review the job description below and contact me ASAP if you are interested.",
  })

  assert.equal(adapted.location, "U.S(Remote)")
})

// ---------------------------------------------------------------------------
// Visa / sponsorship detection — Phase 5
// ---------------------------------------------------------------------------

test("normalizeCrawlerJobForPersistence sets explicit_sponsorship_status=sponsors on clear positive text", () => {
  const result = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: "url:visa-pos-1",
      title: "Software Engineer",
      url: "https://jobs.example.com/openings/swe",
      description:
        "We will sponsor work visas for qualified candidates. Visa sponsorship available. Join our team and we will take care of the rest.",
    },
    crawledAtIso: "2026-04-28T00:00:00.000Z",
  })

  assert.equal(result.canonical.visa.explicit_sponsorship_status.value, "sponsors")
  assert.equal(result.nextColumns.sponsors_h1b, true)
  assert.equal(result.canonical.visa.sponsors_h1b.value, true)
  // view model must reflect the confirmation
  assert.equal(result.pageView.visa_card_label, "Sponsors")
  assert.equal(result.pageView.show_visa_drawer, true)
  assert.equal(result.cardView.visa_card_label, "Sponsors")
  assert.equal(result.cardView.show_visa_drawer, true)
})

test("normalizeCrawlerJobForPersistence sets explicit_sponsorship_status=no_sponsorship on clear negative text", () => {
  // Descriptions must be > 120 chars with > 80 letters to pass cleanJobDescription's
  // plausibility check. Pad each phrase with a realistic role description suffix.
  const suffix =
    " We are looking for a skilled Product Manager with 5+ years of experience. You will define product strategy, work closely with engineering and design, and drive execution. Excellent communication skills required."
  for (const phrase of [
    "No sponsorship available for this position.",
    "Candidates must be authorized to work in the US. We are unable to provide sponsorship.",
    "H1B sponsorship is not available for this role.",
  ]) {
    const result = normalizeCrawlerJobForPersistence({
      rawJob: {
        externalId: `url:visa-neg-${phrase.length}`,
        title: "Product Manager",
        url: "https://jobs.example.com/openings/pm",
        description: `${phrase}${suffix}`,
      },
      crawledAtIso: "2026-04-28T00:00:00.000Z",
    })

    assert.equal(
      result.canonical.visa.explicit_sponsorship_status.value,
      "no_sponsorship",
      `Expected no_sponsorship for phrase: "${phrase}"`
    )
    assert.equal(result.nextColumns.sponsors_h1b, false)
    // view model must NOT show a positive drawer label
    assert.equal(result.cardView.visa_card_label, "No sponsorship")
    assert.equal(result.cardView.show_visa_drawer, false)
    assert.equal(result.pageView.show_visa_drawer, false)
  }
})

test("normalizeCrawlerJobForPersistence sets explicit_sponsorship_status=unclear when visa terms present but ambiguous", () => {
  const result = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: "url:visa-unclear-1",
      title: "Data Scientist",
      url: "https://jobs.example.com/openings/ds",
      description:
        "Strong background in machine learning required. Work authorization is required to work in the United States; OPT is acceptable for this position. The role involves building predictive models, collaborating with product and data engineering teams. 5+ years of relevant experience with Python, SQL, and modern ML frameworks expected.",
    },
    crawledAtIso: "2026-04-28T00:00:00.000Z",
  })

  assert.equal(result.canonical.visa.explicit_sponsorship_status.value, "unclear")
  assert.equal(result.nextColumns.sponsors_h1b, null)
  // card label is null from normalizer — UI layer decides based on company records
  assert.equal(result.cardView.visa_card_label, null)
  assert.equal(result.cardView.show_visa_drawer, false)
})

test("normalizeCrawlerJobForPersistence sets explicit_sponsorship_status=not_detected when no visa terms", () => {
  const result = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: "url:visa-none-1",
      title: "Marketing Manager",
      url: "https://jobs.example.com/openings/marketing",
      description:
        "Lead integrated marketing campaigns. Develop brand strategy. 5+ years of marketing experience required. Excellent communication skills needed.",
    },
    crawledAtIso: "2026-04-28T00:00:00.000Z",
  })

  assert.equal(result.canonical.visa.explicit_sponsorship_status.value, "not_detected")
  assert.equal(result.nextColumns.sponsors_h1b, null)
  assert.equal(result.cardView.visa_card_label, null)
  assert.equal(result.cardView.show_visa_drawer, false)
  assert.equal(result.pageView.visa_card_label, null)
  assert.equal(result.pageView.show_visa_drawer, false)
})

test("sponsorship_badge backward compat: 'likely' still emitted when score>=65 and no explicit status", () => {
  // sponsorship_badge is kept for sponsorship-employer-signal.ts downstream;
  // the new visa_card_label is what gates UI display.
  const result = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: "url:badge-likely-1",
      title: "Software Engineer",
      url: "https://jobs.example.com/openings/swe",
      description: "Build cool things. No visa terms mentioned.",
    },
    crawledAtIso: "2026-04-28T00:00:00.000Z",
    existing: {
      description: null,
      employment_type: null,
      seniority_level: null,
      is_remote: null,
      is_hybrid: null,
      requires_authorization: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      sponsors_h1b: null,
      // Pre-existing high score (from prior LCA enrichment)
      sponsorship_score: 80,
      visa_language_detected: null,
    },
  })

  // sponsorship_badge can be "likely" from score — backward compat maintained
  assert.equal(result.cardView.sponsorship_badge, "likely")
  // BUT visa_card_label must be null (no explicit JD text)
  assert.equal(result.cardView.visa_card_label, null)
  assert.equal(result.cardView.show_visa_drawer, false)
})

// ---------------------------------------------------------------------------
// resolveJobCardView visa fields — explicit DB columns
// ---------------------------------------------------------------------------

test("resolveJobCardView returns visa_card_label=Sponsors when sponsors_h1b=true", () => {
  const card = resolveJobCardView({
    title: "Engineer",
    location: "Remote",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    employment_type: null,
    seniority_level: null,
    description: null,
    skills: [],
    sponsors_h1b: true,
    requires_authorization: false,
    sponsorship_score: 0,
    raw_data: null,
  })

  assert.equal(card.visa_card_label, "Sponsors")
  assert.equal(card.show_visa_drawer, true)
})

test("resolveJobCardView returns visa_card_label=No sponsorship when requires_authorization=true", () => {
  const card = resolveJobCardView({
    title: "Engineer",
    location: "Remote",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    employment_type: null,
    seniority_level: null,
    description: null,
    skills: [],
    sponsors_h1b: null,
    requires_authorization: true,
    sponsorship_score: 0,
    raw_data: null,
  })

  assert.equal(card.visa_card_label, "No sponsorship")
  assert.equal(card.show_visa_drawer, false)
})

test("resolveJobCardView returns visa_card_label=null when no explicit data", () => {
  const card = resolveJobCardView({
    title: "Engineer",
    location: "Remote",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    employment_type: null,
    seniority_level: null,
    description: null,
    skills: [],
    sponsors_h1b: null,
    requires_authorization: false,
    sponsorship_score: 65,  // score alone must not produce a card label
    raw_data: null,
  })

  assert.equal(card.visa_card_label, null)
  assert.equal(card.show_visa_drawer, false)
  // But sponsorship_badge backward compat still works
  assert.equal(card.sponsorship_badge, "likely")
})

// ---------------------------------------------------------------------------
// Top Applicant evidence gate — Phase 6
// ---------------------------------------------------------------------------

test("buildTopApplicantOpportunityBadgeTitle requires freshness AND evidence", async () => {
  const { buildTopApplicantOpportunityBadgeTitle } = await import(
    "@/lib/jobs/job-card-badges"
  )
  const baseJob = {
    id: "job-1",
    first_detected_at: new Date().toISOString(),  // fresh today
    last_seen_at: new Date().toISOString(),
    raw_data: null,
  }

  // Fresh + good match → show
  const show1 = buildTopApplicantOpportunityBadgeTitle(baseJob as Parameters<typeof buildTopApplicantOpportunityBadgeTitle>[0], 75)
  assert.equal(show1.show, true, "should show when fresh + match >= 60")

  // Fresh + low match + no applicants → do NOT show
  const show2 = buildTopApplicantOpportunityBadgeTitle(baseJob as Parameters<typeof buildTopApplicantOpportunityBadgeTitle>[0], 40)
  assert.equal(show2.show, false, "should not show when match < 60 and no applicant count")

  // Stale + good match → do NOT show
  const staleJob = {
    ...baseJob,
    first_detected_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  }
  const show3 = buildTopApplicantOpportunityBadgeTitle(staleJob as Parameters<typeof buildTopApplicantOpportunityBadgeTitle>[0], 90)
  assert.equal(show3.show, false, "should not show when posting is 5+ days old")

  // Fresh + low match + few applicants → show
  const fewApplicantsJob = {
    ...baseJob,
    raw_data: { applicant_count: 10 },
  }
  const show4 = buildTopApplicantOpportunityBadgeTitle(fewApplicantsJob as unknown as Parameters<typeof buildTopApplicantOpportunityBadgeTitle>[0], 40)
  assert.equal(show4.show, true, "should show when fresh + few applicants even if match < 60")
})

// ---------------------------------------------------------------------------
// Ghost job risk — Phase 7
// ---------------------------------------------------------------------------

test("calculateGhostJobRisk produces high risk for very old posting with dead URL", async () => {
  const { calculateGhostJobRisk } = await import("@/lib/jobs/ghost-job-risk")
  const now = new Date()
  const result = calculateGhostJobRisk({
    postedAt: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString(), // 120 days old
    applyUrlStatus: "dead",
    description: "Build things at a fast-paced startup. Rockstar engineer wanted.",
    now,
  })

  assert.equal(result.label, "High")
  assert.ok(result.reasons.length > 0, "should have reasons for high ghost risk")
  assert.ok(result.riskScore !== null && result.riskScore >= 70, "risk score should be >= 70")
})

test("calculateGhostJobRisk produces low risk for fresh posting from known ATS", async () => {
  const { calculateGhostJobRisk } = await import("@/lib/jobs/ghost-job-risk")
  const now = new Date()
  const result = calculateGhostJobRisk({
    postedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days old
    applyUrlStatus: "ok",
    atsType: "greenhouse",
    applyUrl: "https://boards.greenhouse.io/example/jobs/123",
    description: "We are building the hiring platform for international candidates worldwide. Responsibilities: Build frontend features. Requirements: 4+ years of experience with TypeScript. Benefits: Health, dental, vision.",
    now,
  })

  assert.equal(result.label, "Low")
  assert.ok(result.riskScore !== null && result.riskScore < 40, "risk score should be < 40")
})

test("adaptRawCrawlerJob rejects location strings dominated by chrome or commas", () => {
  const chromeLocation = adaptRawCrawlerJob({
    externalId: "url:chrome-loc-1",
    title: "Engineer",
    url: "https://jobs.example.com/openings/engineer",
    description: "We build infrastructure.",
    location: "Sign in to create job alert",
  })
  assert.equal(chromeLocation.location, null)

  const sentenceFragment = adaptRawCrawlerJob({
    externalId: "url:chrome-loc-2",
    title: "Engineer",
    url: "https://jobs.example.com/openings/engineer",
    description: "We build infrastructure.",
    location: "Many roles, many cities, many teams, many opportunities for growth",
  })
  assert.equal(sentenceFragment.location, null)

  const requisitionLike = adaptRawCrawlerJob({
    externalId: "url:chrome-loc-3",
    title: "Engineer",
    url: "https://jobs.example.com/openings/engineer",
    description: "We build infrastructure.",
    location: "REQ-12345-2026-04",
  })
  assert.equal(requisitionLike.location, null)

  const valid = adaptRawCrawlerJob({
    externalId: "url:chrome-loc-4",
    title: "Engineer",
    url: "https://jobs.example.com/openings/engineer",
    description: "We build infrastructure.",
    location: "San Francisco, CA",
  })
  assert.equal(valid.location, "San Francisco, CA")
})
