import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  isPlaceholderName,
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

test("an ATS vendor host does not identify the employer", () => {
  for (const d of ["myworkdayjobs.com", "bamboohr.com", "icims.com", "oraclecloud.com", "jobs.lever.co"]) {
    assert.equal(registrableDomain(d), null, `${d} should not identify an employer`)
  }
})

test("a vendor host does not make a group look ambiguous", () => {
  // workday/ZOLLMedicalCorp was held apart on myworkdayjobs.com vs zoll.com.
  // The vendor host is shared by every member of the group by definition, so it
  // says nothing about who the employer is — this is one company.
  const result = resolveDuplicates([
    candidate({ id: "vendor", domain: "zoll.wd5.myworkdayjobs.com", jobCount: 3 }),
    candidate({ id: "real", domain: "zoll.com", jobCount: 40 }),
  ])

  assert.equal(merged(result).survivor.id, "real")
  assert.equal(merged(result).losers.length, 1)
})

test("a vendor host is never promoted onto a survivor", () => {
  const result = resolveDuplicates([
    candidate({ id: "keep", domain: "acme.bamboohr-tenant", jobCount: 9 }),
    candidate({ id: "vendor", domain: "acme.bamboohr.com", jobCount: 1 }),
  ])
  assert.equal(merged(result).promoteDomain, null)
})

test("isPlaceholderName rejects board coordinates, title fragments and taglines", () => {
  // All three shapes were live employer names created by the Career Site Scout.
  assert.equal(isPlaceholderName("Conocophillips:Wd1:External"), true)
  assert.equal(isPlaceholderName("bakerhughes/BakerHughes"), true)
  assert.equal(isPlaceholderName("Global Payments  |"), true)
  assert.equal(isPlaceholderName("Make your next move matter"), true)
  assert.equal(isPlaceholderName(""), true)
  assert.equal(isPlaceholderName(null), true)
})

test("isPlaceholderName keeps real company names", () => {
  for (const name of ["ConocoPhillips", "Baker Hughes", "Global Payments", "Deel", "U.S. Bank", "Metropolis Technologies"]) {
    assert.equal(isPlaceholderName(name), false, name)
  }
})

test("resolveDuplicates promotes a real name onto a coordinate-named survivor", () => {
  // The ConocoPhillips shape: the shadow wins on job count but is named after
  // the board, so the real name must follow the merge onto it.
  const plan = resolveDuplicates([
    { id: "shadow", name: "Conocophillips:Wd1:External", domain: "conocophillips:wd1:External.workday-scout", isActive: true, jobCount: 77, createdAt: "2026-08-19" },
    { id: "real", name: "ConocoPhillips", domain: "conocophillips.com", isActive: true, jobCount: 41, createdAt: "2026-04-25" },
  ])
  assert.equal(plan?.status, "merge")
  if (plan?.status !== "merge") return
  assert.equal(plan.survivor.id, "shadow")
  assert.equal(plan.promoteName, "ConocoPhillips")
  assert.equal(plan.promoteDomain, "conocophillips.com")
})

test("resolveDuplicates leaves a good survivor name alone", () => {
  const plan = resolveDuplicates([
    { id: "real", name: "ConocoPhillips", domain: "conocophillips.com", isActive: true, jobCount: 90, createdAt: "2026-04-25" },
    { id: "shadow", name: "Conocophillips:Wd1:External", domain: "x.workday-scout", isActive: true, jobCount: 10, createdAt: "2026-08-19" },
  ])
  assert.equal(plan?.status, "merge")
  if (plan?.status !== "merge") return
  assert.equal(plan.promoteName, null)
})
