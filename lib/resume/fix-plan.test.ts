import { strict as assert } from "node:assert"
import { test } from "node:test"
import { planFixes, questionsFor, studioHrefForFinding, studioSectionFor } from "./fix-plan"
import type { ResumeFinding } from "./review"

function finding(id: string, over: Partial<ResumeFinding> = {}): ResumeFinding {
  return {
    id,
    severity: "major",
    weight: 50,
    title: `Title for ${id}`,
    observation: "Observation.",
    cost: "Cost.",
    evidence: ["evidence one", "evidence two"],
    fix: "Fix it.",
    ...over,
  }
}

const ALL_IDS = [
  "authorization_silent",
  "split_signal",
  "targeting_sponsorship",
  "academic_cv_for_industry",
  "concurrent_current_roles",
  "buried_signal",
  "no_lane",
  "employment_gap",
  "too_long",
  "contact_incomplete",
  "dense_bullets",
  "unquantified",
  "weak_summary",
  "skill_gaps",
]

// ── The split is the point ───────────────────────────────────────────────────

test("fixes that need no new facts are automatic", () => {
  const plan = planFixes(["buried_signal", "weak_summary", "dense_bullets", "too_long"].map((id) => finding(id)))
  assert.equal(plan.auto.length, 4)
  assert.equal(plan.needsInput.length, 0)
  assert.equal(plan.manual.length, 0)
  for (const s of plan.auto) {
    assert.equal(s.mechanism, "ai_edit")
    assert.ok(s.section, `${s.findingId} must name the section it edits`)
  }
})

test("nothing that would require inventing a fact is ever marked auto", () => {
  const fabricationRisk = [
    "unquantified",
    "authorization_silent",
    "concurrent_current_roles",
    "contact_incomplete",
  ]
  const plan = planFixes(fabricationRisk.map((id) => finding(id)))
  assert.equal(plan.auto.length, 0, "these can only be answered by the user")
  assert.equal(plan.needsInput.length, fabricationRisk.length)
  for (const s of plan.needsInput) {
    assert.ok(s.reason && s.reason.length > 20, `${s.findingId} must say why it cannot be automated`)
    assert.ok(s.questions?.length, `${s.findingId} must ask something`)
  }
})

test("the quantify fix refuses to invent metrics and says so", () => {
  const plan = planFixes([finding("unquantified")])
  const s = plan.needsInput[0]
  assert.equal(s.kind, "needs_input")
  assert.match(s.reason ?? "", /not invent|fabricat/i)
})

test("decisions are manual and resolve inside the review, not elsewhere", () => {
  const plan = planFixes([finding("split_signal"), finding("targeting_sponsorship"), finding("skill_gaps")])
  assert.equal(plan.manual.length, 3)
  assert.deepEqual(
    plan.manual.map((s) => s.panel),
    ["positioning", "pivot", "skills"],
    "each decision names the in-page panel that resolves it",
  )
})

test("an academic CV is not auto-rewritten into an industry resume", () => {
  const plan = planFixes([finding("academic_cv_for_industry")])
  assert.equal(plan.manual.length, 1)
  assert.equal(plan.manual[0].panel, undefined, "it is a new document, not a review panel")
  assert.match(plan.manual[0].reason ?? "", /right for academia|stay as it is/i)
})

// ── Questions are built from the user's own resume ───────────────────────────

test("the concurrent-roles question offers the actual roles as choices", () => {
  const plan = planFixes([
    finding("concurrent_current_roles", { evidence: ["Founder, HireOven", "GenAI Engineer, Dreamline"] }),
  ])
  const q = plan.needsInput[0].questions?.[0]
  assert.equal(q?.kind, "choice")
  assert.deepEqual(q?.choices, ["Founder, HireOven", "GenAI Engineer, Dreamline"])
})

test("a timeline gap goes to Studio, because a dated entry cannot be guessed", () => {
  const plan = planFixes([
    finding("employment_gap", { evidence: ["Engineer, Old → Engineer, New: 17 months"] }),
  ])
  assert.equal(plan.manual.length, 1)
  assert.equal(plan.needsInput.length, 0)
  assert.match(plan.manual[0].reason ?? "", /17 months/)
})

test("questionsFor flattens the queue and keeps the finding each belongs to", () => {
  const plan = planFixes([finding("unquantified"), finding("authorization_silent"), finding("buried_signal")])
  const qs = questionsFor(plan)
  assert.equal(qs.length, 2, "only needs_input findings ask anything")
  assert.deepEqual(
    qs.map((q) => q.findingId),
    ["unquantified", "authorization_silent"],
  )
  for (const q of qs) assert.ok(q.id && q.prompt)
})

// ── Coverage and robustness ──────────────────────────────────────────────────

test("every finding the review can emit has a planned strategy", () => {
  const plan = planFixes(ALL_IDS.map((id) => finding(id)))
  const planned = [...plan.auto, ...plan.needsInput, ...plan.manual]
  assert.equal(planned.length, ALL_IDS.length)
  // A finding with no registered strategy would fall through as a bare manual
  // entry whose label is just the finding title — catch that here.
  for (const s of planned) {
    assert.ok(!s.label.startsWith("Title for "), `${s.findingId} has no registered strategy`)
  }
})

test("an unknown finding degrades to manual instead of vanishing", () => {
  const plan = planFixes([finding("some_future_check")])
  assert.equal(plan.auto.length, 0)
  assert.equal(plan.manual.length, 1)
  assert.equal(plan.manual[0].findingId, "some_future_check")
})

test("ordering is preserved so the plan follows the review's ranking", () => {
  const plan = planFixes([finding("dense_bullets"), finding("weak_summary"), finding("buried_signal")])
  assert.deepEqual(
    plan.auto.map((s) => s.findingId),
    ["dense_bullets", "weak_summary", "buried_signal"],
  )
})

test("an empty review plans nothing", () => {
  const plan = planFixes([])
  assert.deepEqual(plan, { auto: [], needsInput: [], manual: [] })
  assert.deepEqual(questionsFor(plan), [])
})

// ── Studio hand-off carries the finding ──────────────────────────────────────

test("the Studio link carries the finding so context survives the jump", () => {
  const href = studioHrefForFinding("dense_bullets", "work_experience")
  assert.match(href, /^\/dashboard\/resume\/studio\?/)
  const params = new URLSearchParams(href.split("?")[1])
  assert.equal(params.get("finding"), "dense_bullets")
  assert.equal(params.get("section"), "work_experience")
  assert.equal(params.get("mode"), "preview")
})

test("the Studio link works without a section", () => {
  const params = new URLSearchParams(studioHrefForFinding("too_long").split("?")[1])
  assert.equal(params.get("finding"), "too_long")
  assert.equal(params.get("section"), null)
})

// ── Studio section mapping ───────────────────────────────────────────────────

test("a finding opens the Studio section that actually holds the problem", () => {
  assert.equal(studioSectionFor("dense_bullets", "work_experience"), "experience")
  assert.equal(studioSectionFor("weak_summary", "summary"), "profile")
  assert.equal(studioSectionFor("buried_signal", "skills"), "skills")
})

test("findings whose destination is not implied by a section are mapped explicitly", () => {
  assert.equal(studioSectionFor("contact_incomplete"), "personal")
  assert.equal(studioSectionFor("authorization_silent", "summary"), "profile")
})

test("an unknown finding lands somewhere real rather than throwing", () => {
  assert.equal(studioSectionFor(null, null), "personal")
  assert.equal(studioSectionFor("who_knows"), "personal")
})

test("every auto and needs_input strategy resolves to a Studio section", () => {
  const plan = planFixes(ALL_IDS.map((id) => finding(id)))
  for (const s of [...plan.auto, ...plan.needsInput]) {
    const target = studioSectionFor(s.findingId, s.section)
    assert.ok(target, `${s.findingId} has no Studio destination`)
  }
})
