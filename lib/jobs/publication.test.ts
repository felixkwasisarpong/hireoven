import assert from "node:assert/strict"
import test from "node:test"
import {
  hasUsablePublicJobContent,
  isLikelyCompanyBoilerplateOnly,
  publicationStatusForJob,
  publicationStatusForInsert,
  sqlNotifiableJob,
  sqlPublishedJob,
} from "@/lib/jobs/publication"

test("publicationStatusForJob holds empty jobs for enrichment", () => {
  assert.equal(publicationStatusForJob({ description: "", skills: [] }), "pending_enrichment")
  assert.equal(publicationStatusForJob({ description: "Short LinkedIn shell", skills: [] }), "pending_enrichment")
  assert.equal(
    publicationStatusForJob({
      description: "",
      skills: [],
      sections: {
        responsibilities: { items: [] },
        requirements: { items: [] },
      },
      confidenceScore: 0.2,
      requiresReview: true,
    }),
    "pending_enrichment"
  )
})

test("publicationStatusForJob publishes jobs with useful content", () => {
  assert.equal(
    publicationStatusForJob({
      description:
        "This role builds production APIs, owns service reliability, collaborates with product teams, and ships customer-facing backend systems.",
      skills: [],
    }),
    "published"
  )
  // Skills alone are NOT publishable content. They are extracted from the title
  // and description, so a job with no body yields skills derived from its title
  // — and this rule published Citi roles whose detail page was entirely empty.
  assert.equal(
    publicationStatusForJob({ description: "", skills: ["TypeScript", "Postgres"] }),
    "pending_enrichment"
  )
  assert.equal(hasUsablePublicJobContent({ description: null, skills: ["React"] }), false)
})

test("a job with no body is held even when its title yields skills", () => {
  // Reported case: "Senior Software Engineer (Java/Python)" at Citi, description
  // NULL, skills ["Python", "Java"] — it reached visible_enriched and rendered a
  // detail page with no description on it.
  assert.equal(
    publicationStatusForJob({ description: null, skills: ["Python", "Java"] }),
    "pending_enrichment"
  )
  assert.equal(hasUsablePublicJobContent({ description: null, skills: ["Python", "Java"] }), false)
})

test("parsed role sections count as content when the description column is thin", () => {
  // Sections ARE the description in structured form, so unlike skills they can
  // carry a job on their own — the page has something to render.
  assert.equal(
    publicationStatusForJob({
      description: "",
      skills: [],
      sections: {
        responsibilities: { items: ["Build and operate the payments ledger service."] },
        requirements: { items: ["Five years of backend experience in Java or Go."] },
      },
    }),
    "published"
  )
})

test("publicationStatusForJob hides company boilerplate without role-specific signal", () => {
  const boilerplate = `
About the company
Ibility helps people live a more independent and fulfilling life through technology and services.
Our team is committed to building an inclusive workplace and serving customers with empathy.
We are an equal opportunity employer and provide reasonable accommodation throughout the process.
`

  assert.equal(isLikelyCompanyBoilerplateOnly(boilerplate), true)
  assert.equal(hasUsablePublicJobContent({ description: boilerplate, skills: ["Communication"] }), false)
  assert.equal(
    publicationStatusForJob({
      description: boilerplate,
      skills: ["Communication"],
      sections: {
        company_info: { items: ["Ibility helps people live a more independent and fulfilling life."] },
        responsibilities: { items: [] },
        requirements: { items: [] },
      },
      confidenceScore: 0.48,
      requiresReview: true,
    }),
    "hidden_low_quality"
  )
})

test("publicationStatusForJob keeps role-specific long descriptions publishable", () => {
  const description = `
About the company
We build security products for enterprise customers.
In this role, you will develop detection logic, maintain SIEM pipelines, collaborate with SOC teams, and support incident response workflows.
Requirements include experience with Microsoft Sentinel, KQL, and Python.
`

  assert.equal(isLikelyCompanyBoilerplateOnly(description), false)
  assert.equal(
    publicationStatusForJob({
      description,
      skills: ["Microsoft Sentinel", "KQL"],
      sections: {
        responsibilities: { items: ["Develop detection logic and maintain SIEM pipelines."] },
        requirements: { items: ["Experience with Microsoft Sentinel, KQL, and Python."] },
      },
      confidenceScore: 0.72,
      requiresReview: false,
    }),
    "published"
  )
})

test("sqlPublishedJob emits a null-safe predicate", () => {
  assert.equal(
    sqlPublishedJob("j"),
    "COALESCE(j.publication_status, 'published') IN ('published', 'visible_basic', 'visible_enriched')"
  )
})

test("publicationStatusForInsert maps quality → new visible/hidden states", () => {
  // valid + good content → visible_enriched
  assert.equal(publicationStatusForInsert({ normalizationStatus: "published" }), "visible_enriched")
  // valid + needs enrichment → visible_basic (never the legacy pending_enrichment)
  assert.equal(publicationStatusForInsert({ normalizationStatus: "pending_enrichment" }), "visible_basic")
  // boilerplate-only stays hidden_low_quality
  assert.equal(publicationStatusForInsert({ normalizationStatus: "hidden_low_quality" }), "hidden_low_quality")
  // invalid / duplicate flags take precedence
  assert.equal(publicationStatusForInsert({ invalid: true, normalizationStatus: "published" }), "hidden_invalid")
  assert.equal(publicationStatusForInsert({ duplicate: true, normalizationStatus: "published" }), "hidden_duplicate")
})

test("sqlPublishedJob includes harvested visible states by default", () => {
  assert.equal(
    sqlPublishedJob("jobs"),
    "COALESCE(jobs.publication_status, 'published') IN ('published', 'visible_basic', 'visible_enriched')"
  )
})

test("notifications are narrower than the feed and never include unenriched jobs", () => {
  // visible_basic means "awaiting enrichment" and is often description-light,
  // so it is feed-visible but not something we should proactively push.
  const predicate = sqlNotifiableJob("j")
  assert.ok(predicate.includes("'published'"))
  assert.ok(predicate.includes("'visible_enriched'"))
  assert.ok(!predicate.includes("visible_basic"), "unenriched jobs must not be pushed at users")
})

test("sqlNotifiableJob is null-safe and narrower than the feed", () => {
  assert.equal(
    sqlNotifiableJob("j"),
    "COALESCE(j.publication_status, 'published') IN ('published', 'visible_enriched')"
  )
})
