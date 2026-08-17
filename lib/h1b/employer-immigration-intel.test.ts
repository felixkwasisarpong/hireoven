import assert from "node:assert/strict"
import { test } from "node:test"
import { getJobImmigrationIntel } from "./employer-immigration-intel"
import { normalizeEmployerName } from "./normalize-employer"

/**
 * These guard a real false positive that shipped into a render: a junk tenant company named
 * "Dev" inherited the DOL history of "DEV SYSTEMS, INC." (the normalizer strips "systems"),
 * and a Hair Stylist posting was flagged as a green-card advert for a Software Developer role
 * in another state.
 *
 * getJobImmigrationIntel() returns null for short/empty employer keys BEFORE touching the
 * database, so these run without one.
 */

test("a collision-prone short employer name yields no intel at all", async () => {
  for (const name of ["Dev", "AB", "X", "Inc", "LLC"]) {
    const intel = await getJobImmigrationIntel({ companyName: name })
    assert.equal(intel, null, `"${name}" must not resolve to any employer's DOL record`)
  }
})

test("'Dev' really does normalize into a key short enough to collide", () => {
  // If normalizeEmployerName ever stops producing this, the guard's justification changes.
  assert.equal(normalizeEmployerName("Dev"), "dev")
  assert.equal(normalizeEmployerName("DEV SYSTEMS, INC."), "dev")
  assert.ok(normalizeEmployerName("Dev").length < 4, "the short-key hazard is real")
})

test("missing or blank company names yield nothing", async () => {
  for (const name of [null, undefined, "", "   "]) {
    assert.equal(await getJobImmigrationIntel({ companyName: name }), null)
  }
})

test("a name that is only legal suffixes normalizes away and is rejected", async () => {
  // 'Systems Solutions Group' is entirely stripped by LEGAL_SUFFIX_RE.
  assert.equal(normalizeEmployerName("Systems Solutions Group"), "")
  assert.equal(await getJobImmigrationIntel({ companyName: "Systems Solutions Group" }), null)
})
