import assert from "node:assert/strict"
import test from "node:test"
import {
  ANY_INDUSTRY,
  advance,
  describe as describeState,
  goBack,
  selectedLane,
  startConversation,
} from "@/lib/resume/optimize-conversation"
import type { ResumeLane } from "@/lib/resume/lanes"

const lane = (over: Partial<ResumeLane> & { key: string; label: string }): ResumeLane => ({
  kind: "current",
  fit: 78,
  jobCount: 12400,
  sponsorshipPct: 42,
  strengths: [],
  gaps: [],
  rationale: "",
  ...over,
})

const BACKEND = lane({ key: "backend", label: "Backend / Distributed Systems" })
const AI = lane({ key: "ai_ml", label: "AI / Machine Learning", kind: "adjacent", fit: 71 })

test("walks lane -> industry -> ready", () => {
  let s = startConversation([BACKEND, AI], false)
  assert.equal(s.step, "choose_lane")
  s = advance(s, { id: "lane", value: "backend" })
  assert.equal(s.step, "choose_industry")
  s = advance(s, { id: "industry", value: "Fintech" })
  assert.equal(s.step, "ready")
  assert.equal(describeState(s).target?.lane.key, "backend")
  assert.equal(describeState(s).target?.industry, "Fintech")
})

test("'open to all' is a real answer, and clears the industry target", () => {
  let s = startConversation([BACKEND], false)
  s = advance(s, { id: "lane", value: "backend" })
  s = advance(s, { id: "industry", value: ANY_INDUSTRY })
  assert.equal(s.step, "ready")
  const view = describeState(s)
  assert.equal(view.target?.industry, null)
  assert.match(view.narrative[0]!, /general-purpose/)
})

test("a lane that was never offered is rejected", () => {
  // A stale or tampered client must not be able to target a lane the résumé
  // cannot support — that is the whole point of deriving the pick-list.
  const s = startConversation([BACKEND], false)
  const after = advance(s, { id: "lane", value: "rocket_surgery" })
  assert.equal(after.step, "choose_lane")
  assert.equal(after.selectedLaneKey, null)
})

test("industry cannot be answered before a lane", () => {
  const s = startConversation([BACKEND], false)
  assert.equal(advance(s, { id: "industry", value: "Fintech" }).step, "choose_lane")
})

test("blank industry is not accepted as an answer", () => {
  let s = startConversation([BACKEND], false)
  s = advance(s, { id: "lane", value: "backend" })
  assert.equal(advance(s, { id: "industry", value: "   " }).step, "choose_industry")
})

test("no derived lanes blocks into a free-text question rather than an empty picker", () => {
  const s = startConversation([], false)
  assert.equal(s.step, "blocked")
  const view = describeState(s)
  assert.equal(view.question?.allowFreeText, true)
  assert.deepEqual(view.question?.choices, [])
})

test("an ambiguous résumé is told why it is being asked", () => {
  const view = describeState(startConversation([BACKEND, AI], true))
  assert.match(view.narrative[0]!, /reads as two things at once/)
  assert.match(view.narrative[1]!, /cannot tell in six seconds/)
})

test("a clear résumé gets a confirmation, not an either/or", () => {
  const view = describeState(startConversation([BACKEND, AI], false))
  assert.match(view.narrative[0]!, /reads strongest as/)
})

test("lane choices carry the live numbers", () => {
  const view = describeState(startConversation([BACKEND], false))
  assert.match(view.question!.choices[0]!.hint!, /78% match/)
  assert.match(view.question!.choices[0]!.hint!, /12,400 open/)
  assert.match(view.question!.choices[0]!.hint!, /42% sponsor/)
})

test("a lane with no corpus data shows only the fit", () => {
  const bare = lane({ key: "x", label: "X", jobCount: null, sponsorshipPct: null })
  const view = describeState(startConversation([bare], false))
  assert.equal(view.question!.choices[0]!.hint, "78% match")
})

test("goBack rewinds one step and clears that answer", () => {
  let s = startConversation([BACKEND], false)
  s = advance(s, { id: "lane", value: "backend" })
  s = advance(s, { id: "industry", value: "Fintech" })
  s = goBack(s)
  assert.equal(s.step, "choose_industry")
  assert.equal(s.industry, null)
  s = goBack(s)
  assert.equal(s.step, "choose_lane")
  assert.equal(selectedLane(s), null)
})

test("the ready state promises not to invent skills", () => {
  let s = startConversation([lane({ key: "backend", label: "Backend", gaps: ["rust", "grpc"] })], false)
  s = advance(s, { id: "lane", value: "backend" })
  s = advance(s, { id: "industry", value: ANY_INDUSTRY })
  const view = describeState(s)
  assert.match(view.narrative.join(" "), /will not add skills you have not demonstrated/)
})
