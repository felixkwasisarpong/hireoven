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
  assert.equal(language.includes("go"), true)
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
