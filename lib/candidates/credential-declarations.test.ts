import test from "node:test"
import assert from "node:assert/strict"
import {
  declaredAcquisitionDays,
  normalizeCredentialKey,
  resolveRequirementPresence,
  supportsHardSkip,
  type ResolvePresenceInput,
  type SupportsHardSkipInput,
} from "@/lib/candidates/credential-declarations"

// ─── normalizeCredentialKey ──────────────────────────────────────────────────

test("normalizeCredentialKey collapses punctuation and case", () => {
  assert.equal(normalizeCredentialKey("AWS Certified Solutions Architect"), "aws-certified-solutions-architect")
  assert.equal(normalizeCredentialKey("  PMP  "), "pmp")
  assert.equal(normalizeCredentialKey("CISSP®"), "cissp")
})

test("normalizeCredentialKey maps spelled-out forms to the short key", () => {
  assert.equal(normalizeCredentialKey("Certified Public Accountant"), "cpa")
  assert.equal(normalizeCredentialKey("Project Management Professional"), "pmp")
  assert.equal(normalizeCredentialKey("TS/SCI"), "clearance-ts-sci")
  assert.equal(normalizeCredentialKey("Top Secret"), "clearance-top-secret")
})

test("normalizeCredentialKey returns empty for unusable input", () => {
  for (const value of [null, undefined, "", "   ", "!!!"]) {
    assert.equal(normalizeCredentialKey(value), "", `should be empty: ${JSON.stringify(value)}`)
  }
})

test("normalizeCredentialKey does not merge distinct credentials", () => {
  assert.notEqual(normalizeCredentialKey("CKA"), normalizeCredentialKey("CKAD"))
  assert.notEqual(normalizeCredentialKey("CISSP"), normalizeCredentialKey("CISSP-ISSAP"))
})

// ─── resolveRequirementPresence ──────────────────────────────────────────────

const base: ResolvePresenceInput = {
  declaration: null,
  structuredFieldMatch: false,
  freeTextMatch: false,
  candidateDataReadable: true,
}

test("not finding a credential is NOT_FOUND, never ABSENT_CONFIRMED", () => {
  const result = resolveRequirementPresence(base)
  assert.equal(result.presence, "NOT_FOUND")
  assert.equal(result.contradictionReliability, null)
})

test("unreadable candidate data is UNKNOWN, not NOT_FOUND", () => {
  const result = resolveRequirementPresence({ ...base, candidateDataReadable: false })
  assert.equal(result.presence, "UNKNOWN")
  assert.deepEqual(result.searchedIn, [])
})

test("a structured-field or free-text match establishes PRESENT", () => {
  assert.equal(resolveRequirementPresence({ ...base, structuredFieldMatch: true }).presence, "PRESENT")
  assert.equal(resolveRequirementPresence({ ...base, freeTextMatch: true }).presence, "PRESENT")
})

test("a declaration of 'I hold it' wins even when the resume omits it", () => {
  const result = resolveRequirementPresence({ ...base, declaration: { held: true } })
  assert.equal(result.presence, "PRESENT")
  // Silence in a resume is not a competing claim, so this is not a contradiction.
  assert.equal(result.contradictionReliability, null)
})

test("a declaration of 'I do not hold it' with no resume evidence is ABSENT_CONFIRMED", () => {
  const result = resolveRequirementPresence({ ...base, declaration: { held: false } })
  assert.equal(result.presence, "ABSENT_CONFIRMED")
  assert.equal(result.contradictionReliability, null)
})

test("declaration 'no' against a structured field is CONTRADICTED at field reliability", () => {
  const result = resolveRequirementPresence({
    ...base,
    declaration: { held: false },
    structuredFieldMatch: true,
  })
  assert.equal(result.presence, "CONTRADICTED")
  assert.equal(result.contradictionReliability, "declaration_vs_structured_field")
})

test("declaration 'no' against free text only is the weaker contradiction", () => {
  const result = resolveRequirementPresence({
    ...base,
    declaration: { held: false },
    freeTextMatch: true,
  })
  assert.equal(result.presence, "CONTRADICTED")
  assert.equal(result.contradictionReliability, "declaration_vs_free_text")
})

test("structured field outranks free text when both disagree with a declaration", () => {
  const result = resolveRequirementPresence({
    ...base,
    declaration: { held: false },
    structuredFieldMatch: true,
    freeTextMatch: true,
  })
  assert.equal(result.contradictionReliability, "declaration_vs_structured_field")
})

test("a declaration is usable even when the resume is unreadable", () => {
  const result = resolveRequirementPresence({
    ...base,
    declaration: { held: false },
    candidateDataReadable: false,
  })
  assert.equal(result.presence, "ABSENT_CONFIRMED")
  assert.deepEqual(result.searchedIn, ["candidate_declaration"])
})

// ─── supportsHardSkip ────────────────────────────────────────────────────────

const skipBase: SupportsHardSkipInput = {
  strength: "MANDATORY_EXPLICIT",
  strengthProvenance: "deterministic_pattern",
  presence: "ABSENT_CONFIRMED",
  contradictionReliability: null,
  acquirabilitySource: "unknown",
  acquirabilityEstimatedDays: null,
  opportunityWindowDays: 30,
}

test("an explicit mandatory requirement the candidate confirmed absent supports a skip", () => {
  assert.equal(supportsHardSkip(skipBase), true)
})

test("NOT_FOUND and UNKNOWN can never support a skip", () => {
  // The central guarantee of the whole module: a resume omission is not proof.
  for (const presence of ["NOT_FOUND", "UNKNOWN"] as const) {
    assert.equal(supportsHardSkip({ ...skipBase, presence }), false, `presence: ${presence}`)
  }
})

test("PRESENT obviously cannot support a skip", () => {
  assert.equal(supportsHardSkip({ ...skipBase, presence: "PRESENT" }), false)
})

test("an LLM-only requirement can never support a skip", () => {
  assert.equal(supportsHardSkip({ ...skipBase, strengthProvenance: "llm_only" }), false)
  assert.equal(supportsHardSkip({ ...skipBase, strengthProvenance: "none" }), false)
})

test("non-mandatory strengths can never support a skip", () => {
  for (const strength of ["PREFERRED_EXPLICIT", "INFERRED", "UNKNOWN"] as const) {
    assert.equal(supportsHardSkip({ ...skipBase, strength }), false, `strength: ${strength}`)
  }
})

test("CONTRADICTED supports a skip only at structured-field reliability", () => {
  assert.equal(
    supportsHardSkip({
      ...skipBase,
      presence: "CONTRADICTED",
      contradictionReliability: "declaration_vs_structured_field",
    }),
    true
  )
  for (const reliability of ["declaration_vs_free_text", "free_text_internal"] as const) {
    assert.equal(
      supportsHardSkip({ ...skipBase, presence: "CONTRADICTED", contradictionReliability: reliability }),
      false,
      `reliability: ${reliability}`
    )
  }
})

test("a declared acquisition inside the hiring window blocks the skip", () => {
  assert.equal(
    supportsHardSkip({
      ...skipBase,
      acquirabilitySource: "candidate_declared",
      acquirabilityEstimatedDays: 21,
      opportunityWindowDays: 30,
    }),
    false
  )
})

test("a declared acquisition outside the hiring window still supports the skip", () => {
  assert.equal(
    supportsHardSkip({
      ...skipBase,
      acquirabilitySource: "candidate_declared",
      acquirabilityEstimatedDays: 400,
      opportunityWindowDays: 30,
    }),
    true
  )
})

test("an acquisition estimate without a candidate source is ignored", () => {
  // There is no credential catalog in this repository, and a model may not
  // estimate acquisition time — so an estimate from anywhere else cannot rescue
  // the job.
  assert.equal(
    supportsHardSkip({
      ...skipBase,
      acquirabilitySource: "unknown",
      acquirabilityEstimatedDays: 1,
      opportunityWindowDays: 30,
    }),
    true
  )
})

test("no presence/strength pairing other than the sanctioned ones supports a skip", () => {
  const presences = ["PRESENT", "ABSENT_CONFIRMED", "NOT_FOUND", "CONTRADICTED", "UNKNOWN"] as const
  const strengths = ["MANDATORY_EXPLICIT", "PREFERRED_EXPLICIT", "INFERRED", "UNKNOWN"] as const
  const provenances = [
    "deterministic_pattern",
    "structured_ats_field",
    "section_header_plus_pattern",
    "llm_only",
    "none",
  ] as const

  for (const presence of presences) {
    for (const strength of strengths) {
      for (const strengthProvenance of provenances) {
        const got = supportsHardSkip({ ...skipBase, presence, strength, strengthProvenance })
        const expected =
          strength === "MANDATORY_EXPLICIT" &&
          strengthProvenance !== "llm_only" &&
          strengthProvenance !== "none" &&
          presence === "ABSENT_CONFIRMED"
        assert.equal(got, expected, `${presence} / ${strength} / ${strengthProvenance}`)
      }
    }
  }
})

// ─── declaredAcquisitionDays ─────────────────────────────────────────────────

test("declaredAcquisitionDays counts forward from now", () => {
  const now = new Date("2026-08-13T00:00:00.000Z")
  assert.equal(declaredAcquisitionDays("2026-09-03", now), 21)
  assert.equal(declaredAcquisitionDays("2026-08-13T00:00:00.000Z", now), 0)
})

test("declaredAcquisitionDays returns null for missing, unparseable or past dates", () => {
  const now = new Date("2026-08-13T00:00:00.000Z")
  assert.equal(declaredAcquisitionDays(null, now), null)
  assert.equal(declaredAcquisitionDays("not a date", now), null)
  // A lapsed expectation is a prompt to re-ask, not an estimate.
  assert.equal(declaredAcquisitionDays("2026-07-01", now), null)
})
