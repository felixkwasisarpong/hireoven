import assert from "node:assert/strict"
import test from "node:test"
import {
  hasUsablePublicJobContent,
  isLikelyCompanyBoilerplateOnly,
  publicationStatusForJob,
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
  assert.equal(publicationStatusForJob({ description: "", skills: ["TypeScript", "Postgres"] }), "published")
  assert.equal(hasUsablePublicJobContent({ description: null, skills: ["React"] }), false)
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
  assert.equal(sqlPublishedJob("j"), "COALESCE(j.publication_status, 'published') = 'published'")
})
