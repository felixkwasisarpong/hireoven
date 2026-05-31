import { strict as assert } from "node:assert"
import { test } from "node:test"
import { generateSlugCandidates } from "./slug-candidates"

test("generateSlugCandidates: compact form first, includes hyphenated variant", () => {
  const c = generateSlugCandidates("Acme Robotics Inc.")
  assert.equal(c[0], "acmerobotics") // legal suffix stripped, compacted
  assert.ok(c.includes("acme-robotics"))
  assert.ok(c.includes("acme")) // first word
})

test("generateSlugCandidates: primary candidate strips legal/marketing noise", () => {
  const c = generateSlugCandidates("Boyd Gaming Corporation")
  // Primary (most-likely) candidate has the noise token removed.
  assert.equal(c[0], "boydgaming")
  // A raw-name fallback that keeps everything is still included last.
  assert.ok(c.includes("boydgamingcorporation"))
})

test("generateSlugCandidates: dedups and drops too-short/too-long", () => {
  const c = generateSlugCandidates("A")
  assert.deepEqual(c, []) // single char → nothing usable
  const unique = generateSlugCandidates("Stripe")
  assert.equal(new Set(unique).size, unique.length)
})

test("generateSlugCandidates: handles accents and punctuation", () => {
  const c = generateSlugCandidates("Nubank S.A. (Nu Pagamentos)")
  assert.ok(c.includes("nubank"))
  assert.ok(c.every((s) => /^[a-z0-9-]+$/.test(s)))
})
