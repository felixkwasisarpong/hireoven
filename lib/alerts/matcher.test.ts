import { strict as assert } from "node:assert"
import { test } from "node:test"
import { matchesAlert } from "./matcher"
import type { Job, JobAlert } from "@/types"

function job(partial: Partial<Job>): Job {
  return {
    title: "",
    normalized_title: null,
    skills: [],
    location: null,
    is_remote: false,
    employment_type: null,
    seniority_level: null,
    company_id: "c1",
    apply_url: "",
    sponsors_h1b: null,
    sponsorship_score: null,
    ...partial,
  } as unknown as Job
}
function alert(partial: Partial<JobAlert>): JobAlert {
  return { keywords: null, locations: null, ...partial } as unknown as JobAlert
}

test("keyword matches as a whole word, not a substring", () => {
  // False positives the old substring match produced — now rejected:
  assert.equal(matchesAlert(alert({ keywords: ["java"] }), job({ title: "Senior JavaScript Engineer" })), false)
  assert.equal(matchesAlert(alert({ keywords: ["go"] }), job({ title: "Goldman Sachs Analyst" })), false)
  assert.equal(matchesAlert(alert({ keywords: ["ai"] }), job({ title: "Maintenance Technician" })), false)

  // Genuine matches still pass:
  assert.equal(matchesAlert(alert({ keywords: ["java"] }), job({ title: "Java Backend Engineer" })), true)
  assert.equal(matchesAlert(alert({ keywords: ["go"] }), job({ title: "Go Platform Engineer" })), true)
})

test("multi-word keyword matches as a phrase", () => {
  assert.equal(matchesAlert(alert({ keywords: ["software engineer"] }), job({ title: "Senior Software Engineer, Cloud" })), true)
  assert.equal(matchesAlert(alert({ keywords: ["software engineer"] }), job({ title: "Software Sales Engineer" })), false)
})

test("skills match on whole token, not substring", () => {
  assert.equal(matchesAlert(alert({ keywords: ["java"] }), job({ title: "Backend Dev", skills: ["JavaScript"] })), false)
  assert.equal(matchesAlert(alert({ keywords: ["java"] }), job({ title: "Backend Dev", skills: ["Java", "Spring"] })), true)
})

test("c++ / c# style keywords match", () => {
  assert.equal(matchesAlert(alert({ keywords: ["c++"] }), job({ title: "C++ Systems Engineer" })), true)
  assert.equal(matchesAlert(alert({ keywords: ["c#"] }), job({ title: "Senior C# Developer" })), true)
})

test("empty keywords matches everything (no keyword filter)", () => {
  assert.equal(matchesAlert(alert({ keywords: [] }), job({ title: "Anything" })), true)
})
