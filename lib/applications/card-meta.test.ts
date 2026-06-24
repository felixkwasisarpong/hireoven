import { strict as assert } from "node:assert"
import { test } from "node:test"
import { salaryShort, daysInStage, nextAction, deriveTags } from "./card-meta"
import type { JobApplication } from "@/types"

const DAY = 86_400_000

function app(partial: Partial<JobApplication>): JobApplication {
  return {
    id: "a1",
    user_id: "u1",
    job_id: null,
    resume_id: null,
    status: "applied",
    company_name: "Acme",
    company_logo_url: null,
    job_title: "Engineer",
    apply_url: null,
    applied_at: null,
    match_score: null,
    cover_letter_id: null,
    notes: null,
    follow_up_date: null,
    salary_expected: null,
    salary_offered: null,
    timeline: [],
    interviews: [],
    offer_details: null,
    is_archived: false,
    source: "manual",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  } as JobApplication
}

test("salaryShort: offer base wins, formats k and M", () => {
  assert.equal(salaryShort(app({ salary_expected: 150_000 })), "$150k")
  assert.equal(salaryShort(app({ salary_offered: 95_000, salary_expected: 80_000 })), "$95k")
  assert.equal(
    salaryShort(app({ offer_details: { base_salary: 215_000 }, salary_offered: 100_000 })),
    "$215k"
  )
  assert.equal(salaryShort(app({ salary_expected: 1_200_000 })), "$1.2M")
  assert.equal(salaryShort(app({})), null)
})

test("daysInStage: uses latest matching status-change entry", () => {
  const now = Date.now()
  const a = app({
    status: "interview",
    timeline: [
      { id: "1", type: "status_change", status: "applied", date: new Date(now - 20 * DAY).toISOString(), auto: true },
      { id: "2", type: "status_change", status: "interview", date: new Date(now - 5 * DAY).toISOString(), auto: true },
    ],
  })
  assert.equal(daysInStage(a, now), 5)
})

test("daysInStage: falls back to applied_at for applied status", () => {
  const now = Date.now()
  assert.equal(daysInStage(app({ status: "applied", applied_at: new Date(now - 3 * DAY).toISOString() }), now), 3)
})

test("nextAction: upcoming interview takes priority and warns within 3 days", () => {
  const now = Date.now()
  const a = app({
    follow_up_date: new Date(now + 10 * DAY).toISOString(),
    interviews: [
      { id: "i1", round_name: "Onsite", date: new Date(now + 2 * DAY).toISOString(), format: "onsite" as never, outcome: "pending" as never },
    ],
  })
  const na = nextAction(a, now)
  assert.equal(na?.icon, "calendar")
  assert.equal(na?.tone, "warn")
})

test("nextAction: overdue follow-up is 'due'", () => {
  const now = Date.now()
  const na = nextAction(app({ follow_up_date: new Date(now - 2 * DAY).toISOString() }), now)
  assert.deepEqual(na, { label: "Follow up · overdue", tone: "due", icon: "bell" })
})

test("nextAction: offer deadline only when status is offer", () => {
  const now = Date.now()
  const deadline = new Date(now + 4 * DAY).toISOString()
  assert.equal(nextAction(app({ status: "applied", offer_details: { offer_deadline: deadline } }), now), null)
  const na = nextAction(app({ status: "offer", offer_details: { offer_deadline: deadline } }), now)
  assert.equal(na?.icon, "hourglass")
  assert.equal(na?.label, "Decide · 4d")
})

test("nextAction: none when nothing scheduled", () => {
  assert.equal(nextAction(app({})), null)
})

test("deriveTags: referral + non-generic source, generic dropped", () => {
  assert.deepEqual(deriveTags(app({ source: "referral" })), ["Referral"])
  assert.deepEqual(deriveTags(app({ source: "manual" })), [])
  assert.deepEqual(deriveTags(app({ source: "linkedin" })), ["linkedin"])
})
