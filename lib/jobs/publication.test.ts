import assert from "node:assert/strict"
import test from "node:test"
import {
  hasUsablePublicJobContent,
  publicationStatusForJob,
  sqlPublishedJob,
} from "@/lib/jobs/publication"

test("publicationStatusForJob holds empty jobs for enrichment", () => {
  assert.equal(publicationStatusForJob({ description: "", skills: [] }), "pending_enrichment")
  assert.equal(publicationStatusForJob({ description: "Short LinkedIn shell", skills: [] }), "pending_enrichment")
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

test("sqlPublishedJob emits a null-safe predicate", () => {
  assert.equal(sqlPublishedJob("j"), "COALESCE(j.publication_status, 'published') = 'published'")
})

