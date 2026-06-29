import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici"
import { resolveApplyUrlToAtsTenant } from "@/lib/discovery/resolve-apply-url-to-tenant"
import { __resetAtsRateLimiter } from "@/lib/discovery/ats-rate-limiter"

// Node's global fetch runs on undici, so a MockAgent set as the global
// dispatcher intercepts every fetch the backsolver makes.

const json = { headers: { "content-type": "application/json" } }
const htmlHeaders = { headers: { "content-type": "text/html" } }

let original: Dispatcher
let agent: MockAgent

const RATE_ENV = ["ATS_RATE_LIMIT_QUEUE_CAP", "ATS_RATE_LIMIT_LEVER_RPS", "ATS_RATE_LIMIT_LEVER_BURST", "ATS_RESOLVE_TIMEOUT_MS"]

beforeEach(() => {
  for (const k of RATE_ENV) delete process.env[k]
  __resetAtsRateLimiter()
  original = getGlobalDispatcher()
  agent = new MockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
})

afterEach(async () => {
  await agent.close()
  setGlobalDispatcher(original)
  for (const k of RATE_ENV) delete process.env[k]
  __resetAtsRateLimiter()
})

// ── Direct ATS URLs (detected at hop 0, no redirect fetch) ───────────────────

it("resolves a direct Lever URL and validates the board", async () => {
  agent
    .get("https://api.lever.co")
    .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
    .reply(200, JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]), json)

  const r = await resolveApplyUrlToAtsTenant("https://jobs.lever.co/acme/abc123", "adzuna")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "lever")
  assert.equal(r.atsIdentifier, "acme")
  assert.equal(r.confidence, 90)
  assert.equal(r.jobCount, 3)
  assert.equal(r.sourceType, "adzuna")
  assert.equal(r.sourceUrl, "https://jobs.lever.co/acme/abc123")
})

it("resolves a direct Greenhouse boards.greenhouse.io URL", async () => {
  agent
    .get("https://boards-api.greenhouse.io")
    .intercept({ path: "/v1/boards/acme/jobs", method: "GET" })
    .reply(200, JSON.stringify({ jobs: [{ id: 1 }] }), json)

  const r = await resolveApplyUrlToAtsTenant("https://boards.greenhouse.io/acme/jobs/123")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "greenhouse")
  assert.equal(r.atsIdentifier, "acme")
  assert.equal(r.confidence, 90)
})

it("resolves the job-boards.greenhouse.io variant", async () => {
  agent
    .get("https://boards-api.greenhouse.io")
    .intercept({ path: "/v1/boards/acme/jobs", method: "GET" })
    .reply(200, JSON.stringify({ jobs: [{ id: 1 }, { id: 2 }] }), json)

  const r = await resolveApplyUrlToAtsTenant("https://job-boards.greenhouse.io/acme")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "greenhouse")
  assert.equal(r.atsIdentifier, "acme")
})

it("resolves a direct Ashby URL", async () => {
  agent
    .get("https://api.ashbyhq.com")
    .intercept({ path: "/posting-api/job-board/acme", method: "GET" })
    .reply(200, JSON.stringify({ jobs: [{ id: 1 }] }), json)

  const r = await resolveApplyUrlToAtsTenant("https://jobs.ashbyhq.com/acme/2f1c-uuid")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "ashby")
  assert.equal(r.atsIdentifier, "acme")
  assert.equal(r.confidence, 90)
})

it("resolves a direct SmartRecruiters URL using totalFound", async () => {
  agent
    .get("https://api.smartrecruiters.com")
    .intercept({ path: "/v1/companies/acme/postings", method: "GET" })
    .reply(200, JSON.stringify({ totalFound: 7, content: [] }), json)

  const r = await resolveApplyUrlToAtsTenant("https://jobs.smartrecruiters.com/acme/123-engineer")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "smartrecruiters")
  assert.equal(r.atsIdentifier, "acme")
  assert.equal(r.jobCount, 7)
})

it("accepts a Workday URL as detected-but-unvalidated (no board endpoint)", async () => {
  // No fetch at all: detected at hop 0, and Workday has no cheap validator.
  const r = await resolveApplyUrlToAtsTenant("https://acme.wd1.myworkdayjobs.com/en-US/careers")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "workday")
  assert.equal(r.confidence, 70)
  assert.equal(r.jobCount, undefined)
})

// ── Redirect chains ──────────────────────────────────────────────────────────

it("follows an aggregator redirect to the ATS", async () => {
  agent
    .get("https://track.adzuna.com")
    .intercept({ path: "/x", method: "HEAD", query: { dest: "lever" } })
    .reply(301, "", { headers: { location: "https://jobs.lever.co/acme/123" } })
  agent
    .get("https://api.lever.co")
    .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
    .reply(200, JSON.stringify([{ id: "x" }]), json)

  const r = await resolveApplyUrlToAtsTenant("https://track.adzuna.com/x?dest=lever")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "lever")
  assert.equal(r.atsIdentifier, "acme")
  assert.equal(r.hops, 2)
})

it("follows a multi-hop redirect: redirector → company wrapper → ATS", async () => {
  agent
    .get("https://r.example")
    .intercept({ path: "/1", method: "HEAD" })
    .reply(302, "", { headers: { location: "https://careers.acme.com/" } })
  agent
    .get("https://careers.acme.com")
    .intercept({ path: "/", method: "HEAD" })
    .reply(302, "", { headers: { location: "https://jobs.lever.co/acme" } })
  agent
    .get("https://api.lever.co")
    .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
    .reply(200, JSON.stringify([{ id: "x" }, { id: "y" }]), json)

  const r = await resolveApplyUrlToAtsTenant("https://r.example/1")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "lever")
  assert.equal(r.atsIdentifier, "acme")
  assert.equal(r.domainGuess, "acme.com")
  assert.equal(r.hops, 3)
})

it("detects an ATS embedded in the final page HTML", async () => {
  agent.get("https://careers.acme.com").intercept({ path: "/", method: "HEAD" }).reply(200, "")
  agent
    .get("https://careers.acme.com")
    .intercept({ path: "/", method: "GET" })
    .reply(200, '<html><body><iframe src="https://boards.greenhouse.io/acme"></iframe></body></html>', htmlHeaders)
  agent
    .get("https://boards-api.greenhouse.io")
    .intercept({ path: "/v1/boards/acme/jobs", method: "GET" })
    .reply(200, JSON.stringify({ jobs: [{ id: 1 }] }), json)

  const r = await resolveApplyUrlToAtsTenant("https://careers.acme.com/")
  assert.equal(r.success, true)
  assert.equal(r.atsType, "greenhouse")
  assert.equal(r.atsIdentifier, "acme")
})

// ── Failure modes ────────────────────────────────────────────────────────────

it("returns no_ats_match for a garbage URL", async () => {
  agent.get("https://randomco.example").intercept({ path: "/careers", method: "HEAD" }).reply(200, "")
  agent
    .get("https://randomco.example")
    .intercept({ path: "/careers", method: "GET" })
    .reply(200, "<html><body>nothing useful here</body></html>", htmlHeaders)

  const r = await resolveApplyUrlToAtsTenant("https://randomco.example/careers")
  assert.equal(r.success, false)
  assert.equal(r.errorReason, "no_ats_match")
})

it("returns success=true confidence=60 when the board is empty", async () => {
  agent
    .get("https://api.lever.co")
    .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
    .reply(200, JSON.stringify([]), json)

  const r = await resolveApplyUrlToAtsTenant("https://jobs.lever.co/acme/abc")
  assert.equal(r.success, true)
  assert.equal(r.confidence, 60)
  assert.equal(r.jobCount, 0)
})

it("returns no_ats_match when the board 404s (wrong slug)", async () => {
  agent
    .get("https://api.lever.co")
    .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
    .reply(404, "not found")

  const r = await resolveApplyUrlToAtsTenant("https://jobs.lever.co/acme/abc")
  assert.equal(r.success, false)
  assert.equal(r.errorReason, "no_ats_match")
})

it("returns board_error on a 5xx board response", async () => {
  agent
    .get("https://api.lever.co")
    .intercept({ path: "/v0/postings/acme", method: "GET", query: { mode: "json" } })
    .reply(503, "down")

  const r = await resolveApplyUrlToAtsTenant("https://jobs.lever.co/acme/abc")
  assert.equal(r.success, false)
  assert.equal(r.errorReason, "board_error")
})

it("detects a redirect loop (A → B → A)", async () => {
  agent.get("https://a.example").intercept({ path: "/", method: "HEAD" })
    .reply(301, "", { headers: { location: "https://b.example/" } })
  agent.get("https://b.example").intercept({ path: "/", method: "HEAD" })
    .reply(301, "", { headers: { location: "https://a.example/" } })

  const r = await resolveApplyUrlToAtsTenant("https://a.example/")
  assert.equal(r.success, false)
  assert.equal(r.errorReason, "redirect_loop")
})

it("returns timeout when the chain exceeds the budget", async () => {
  process.env.ATS_RESOLVE_TIMEOUT_MS = "20"
  agent
    .get("https://slow.example")
    .intercept({ path: "/go", method: "HEAD" })
    .reply(301, "", { headers: { location: "https://jobs.lever.co/acme" } })
    .delay(200)

  const r = await resolveApplyUrlToAtsTenant("https://slow.example/go")
  assert.equal(r.success, false)
  assert.equal(r.errorReason, "timeout")
})

it("returns rate_limited when the limiter queue is full", async () => {
  process.env.ATS_RATE_LIMIT_QUEUE_CAP = "0"
  process.env.ATS_RATE_LIMIT_LEVER_RPS = "0"
  process.env.ATS_RATE_LIMIT_LEVER_BURST = "0"
  __resetAtsRateLimiter() // re-read env into a fresh bucket

  // Direct Lever URL ⇒ detected at hop 0 (no chain fetch); the only fetch would
  // be the board validation, which the limiter rejects before it runs.
  const r = await resolveApplyUrlToAtsTenant("https://jobs.lever.co/acme/abc")
  assert.equal(r.success, false)
  assert.equal(r.errorReason, "rate_limited")
})
