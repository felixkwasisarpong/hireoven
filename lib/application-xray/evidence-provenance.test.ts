import assert from "node:assert/strict"
import test from "node:test"
import { scoreApplicationXRay } from "./scorer"
import { baseInputForTraceTests } from "./test-helpers"

/**
 * A positive evidence claim — "your resume shows X" — is the one kind of
 * statement X-Ray makes *about the candidate* rather than about a posting. It
 * has to be traceable to something we actually read. An item marked `present`
 * with empty or dangling provenance is an unfalsifiable assertion, and the
 * contract's whole basis/source discipline collapses if those are allowed.
 *
 * Absences are held to a different standard on purpose: "we did not find it"
 * cites the search, not a span, so a `not_found` item may legitimately carry no
 * source fact.
 */

function collectFactIds(xray: ReturnType<typeof scoreApplicationXRay>): Set<string> {
  return new Set(xray.sourceFacts.map((fact) => fact.id))
}

test("every present evidence item cites at least one source fact", () => {
  const xray = scoreApplicationXRay(baseInputForTraceTests())
  const present = xray.evidence.requirementSupport.filter((item) => item.status === "present")
  assert.ok(present.length > 0, "fixture must exercise at least one present item")

  for (const item of present) {
    assert.ok(
      item.sourceFactIds.length > 0,
      `present evidence "${item.requirement}" has empty provenance — an unfalsifiable positive claim`,
    )
  }
})

test("no evidence item references a dangling source fact id", () => {
  const xray = scoreApplicationXRay(baseInputForTraceTests())
  const known = collectFactIds(xray)

  for (const item of xray.evidence.requirementSupport) {
    for (const id of item.sourceFactIds) {
      assert.ok(
        known.has(id),
        `evidence "${item.requirement}" cites sourceFactId "${id}" which resolves to nothing`,
      )
    }
  }
})

test("every finding across all dimensions resolves its provenance", () => {
  const xray = scoreApplicationXRay(baseInputForTraceTests())
  const known = collectFactIds(xray)
  const dimensions = [
    ["hiringReality", xray.hiringReality],
    ["capability", xray.capability],
    ["evidence", xray.evidence],
    ["eligibility", xray.eligibility],
    ["positioning", xray.positioning],
  ] as const

  for (const [name, dimension] of dimensions) {
    for (const finding of dimension.findings) {
      for (const id of finding.sourceFactIds) {
        assert.ok(known.has(id), `${name} finding "${finding.id}" cites unknown fact "${id}"`)
      }
    }
  }
})

test("an absence may cite nothing, but must declare why it is absent", () => {
  const xray = scoreApplicationXRay(baseInputForTraceTests())
  for (const item of xray.evidence.requirementSupport) {
    if (item.status === "present") continue
    assert.ok(
      item.absenceKind !== null,
      `non-present item "${item.requirement}" has no absenceKind — "not found" and "confirmed absent" would be indistinguishable`,
    )
  }
})
