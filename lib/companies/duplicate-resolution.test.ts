import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  isSyntheticDomain,
  registrableDomain,
  resolveDuplicates,
  type DuplicateCandidate,
} from "./duplicate-resolution"

const candidate = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: "a",
  domain: "metropolis.com",
  isActive: true,
  jobCount: 10,
  createdAt: "2026-05-22T00:00:00.000Z",
  ...over,
})

/** Narrow to a merge plan, failing the test if the group was held as ambiguous. */
function merged(result: ReturnType<typeof resolveDuplicates>) {
  assert.equal(result?.status, "merge")
  if (result?.status !== "merge") throw new Error("unreachable")
  return result
}

test("subsystem-minted domains are recognised as synthetic", () => {
  for (const d of [
    "metropolis.greenhouse-discovered",
    "metropolis.greenhouse-tenant",
    "metropolis.greenhouse-scout",
    "acme.ats-placeholder",
    "acme.smartrecruiters-discovered",
    "acme.discovered",
    "acme.sourced",
    "unknown.local",
    null,
    "",
  ]) {
    assert.equal(isSyntheticDomain(d), true, `${d} should be synthetic`)
  }
})

test("real domains are not mistaken for placeholders", () => {
  for (const d of ["metropolis.com", "openai.io", "some.co", "a.edu", "x.ai", "tenant.com"]) {
    assert.equal(isSyntheticDomain(d), false, `${d} should be real`)
  }
})

test("a single record is not a merge", () => {
  assert.equal(resolveDuplicates([candidate()]), null)
  assert.equal(resolveDuplicates([]), null)
})

test("the fullest record survives, not the prettiest domain", () => {
  // This is the regression that stranded live records behind a dead one: the
  // nicer domain won, and the row that actually had a working board lost.
  const real = candidate({ id: "real", domain: "metropolis.com", jobCount: 0, isActive: false })
  const working = candidate({ id: "working", domain: "metropolis.greenhouse-tenant", jobCount: 96 })

  const result = resolveDuplicates([real, working])

  assert.equal(merged(result).survivor.id, "working")
  assert.deepEqual(merged(result).losers.map((l) => l.id), ["real"])
})

test("the real domain is promoted onto a survivor that only has a synthetic one", () => {
  const result = resolveDuplicates([
    candidate({ id: "real", domain: "metropolis.com", jobCount: 0 }),
    candidate({ id: "working", domain: "metropolis.greenhouse-tenant", jobCount: 96 }),
  ])

  assert.equal(merged(result).survivor.id, "working")
  assert.equal(merged(result).promoteDomain, "metropolis.com")
})

test("a survivor that already has a real domain keeps it", () => {
  const result = resolveDuplicates([
    candidate({ id: "keep", domain: "metropolis.com", jobCount: 96 }),
    candidate({ id: "other", domain: "metropolis.greenhouse-tenant", jobCount: 5 }),
  ])

  assert.equal(merged(result).survivor.id, "keep")
  assert.equal(merged(result).promoteDomain, null)
})

test("nothing is promoted when the whole group is synthetic", () => {
  const result = resolveDuplicates([
    candidate({ id: "a", domain: "x.greenhouse-tenant", jobCount: 9 }),
    candidate({ id: "b", domain: "x.greenhouse-scout", jobCount: 2 }),
  ])

  assert.equal(merged(result).promoteDomain, null)
})

test("equal job counts fall back to real domain, then activity, then age", () => {
  const byDomain = resolveDuplicates([
    candidate({ id: "synthetic", domain: "x.greenhouse-scout", jobCount: 5 }),
    candidate({ id: "real", domain: "x.com", jobCount: 5 }),
  ])
  assert.equal(merged(byDomain).survivor.id, "real")

  const byActivity = resolveDuplicates([
    candidate({ id: "dormant", domain: "x.com", jobCount: 5, isActive: false }),
    candidate({ id: "live", domain: "x.com", jobCount: 5, isActive: true }),
  ])
  assert.equal(merged(byActivity).survivor.id, "live")

  const byAge = resolveDuplicates([
    candidate({ id: "newer", jobCount: 5, createdAt: "2026-08-18T00:00:00.000Z" }),
    candidate({ id: "older", jobCount: 5, createdAt: "2026-05-22T00:00:00.000Z" }),
  ])
  assert.equal(merged(byAge).survivor.id, "older")
})

test("every record in the group is accounted for as survivor or loser", () => {
  const group = [
    candidate({ id: "a", jobCount: 1 }),
    candidate({ id: "b", jobCount: 2 }),
    candidate({ id: "c", jobCount: 3 }),
    candidate({ id: "d", jobCount: 4 }),
  ]
  const result = resolveDuplicates(group)
  const seen = [merged(result).survivor.id, ...merged(result).losers.map((l) => l.id)].sort()
  assert.deepEqual(seen, ["a", "b", "c", "d"])
})

test("registrableDomain reduces to the last two labels and ignores synthetics", () => {
  assert.equal(registrableDomain("secure.axyz-design.com"), "axyz-design.com")
  assert.equal(registrableDomain("metropolis.com"), "metropolis.com")
  assert.equal(registrableDomain("x.greenhouse-tenant"), null)
  assert.equal(registrableDomain(null), null)
})

test("two different real domains means identity is ambiguous, not a merge", () => {
  // ashby/column is held by both Column (column.com) and Column Five Media
  // (columnfivemedia.com). One identifier, two companies — merging them would
  // fuse two employers into one, so the group is held for review instead.
  const result = resolveDuplicates([
    candidate({ id: "column", domain: "column.com", jobCount: 22 }),
    candidate({ id: "columnfive", domain: "columnfivemedia.com", jobCount: 0 }),
  ])

  assert.equal(result?.status, "ambiguous")
  if (result?.status !== "ambiguous") return
  assert.deepEqual(result.realDomains.sort(), ["column.com", "columnfivemedia.com"])
})

test("subdomains of one real domain are not treated as two companies", () => {
  const result = resolveDuplicates([
    candidate({ id: "a", domain: "secure.axyz-design.com", jobCount: 0 }),
    candidate({ id: "b", domain: "axyz-design.com", jobCount: 7 }),
  ])
  assert.equal(merged(result).survivor.id, "b")
})

test("one real domain among synthetics still merges", () => {
  const result = resolveDuplicates([
    candidate({ id: "real", domain: "metropolis.com", jobCount: 122 }),
    candidate({ id: "tenant", domain: "metropolis.greenhouse-tenant", jobCount: 96 }),
    candidate({ id: "scout", domain: "metropolis.greenhouse-scout", jobCount: 69 }),
  ])
  assert.equal(merged(result).survivor.id, "real")
  assert.equal(merged(result).losers.length, 2)
})
