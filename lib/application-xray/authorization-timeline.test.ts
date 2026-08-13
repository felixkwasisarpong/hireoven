import assert from "node:assert/strict"
import test from "node:test"
import { buildCandidateAuthorizationTimeline } from "./authorization-timeline"

test("schema defaults produce an unknown candidate timeline", () => {
  const timeline = buildCandidateAuthorizationTimeline({
    visaStatus: null,
    workAuthorization: null,
    authorizationEndDate: null,
    roleRelatedToDegree: "unknown",
    stemDegreeEligible: "unknown",
    derivedFromDefaultsOnly: true,
    readFrom: [],
  })

  assert.equal(timeline.canWorkForTargetEmployerWithoutNewImmigrationAction, "UNKNOWN")
  assert.equal(timeline.derivedFromDefaultsOnly, true)
})

test("OPT can be authorized now while preserving possible future employer actions", () => {
  const timeline = buildCandidateAuthorizationTimeline({
    visaStatus: "opt",
    workAuthorization: "opt",
    authorizationEndDate: "2027-05-13",
    roleRelatedToDegree: true,
    stemDegreeEligible: true,
    derivedFromDefaultsOnly: false,
    readFrom: ["profiles.visa_status"],
  })

  assert.equal(timeline.canWorkForTargetEmployerWithoutNewImmigrationAction, "YES")
  assert.deepEqual(
    timeline.futureEmployerActions.map((action) => [action.type, action.status]),
    [
      ["H1B_PETITION", "POSSIBLE"],
      ["STEM_OPT_EVERIFY_PARTICIPATION", "POSSIBLE"],
      ["STEM_OPT_I983", "POSSIBLE"],
    ],
  )
})

test("STEM OPT and H-1B are target-employer action states", () => {
  const stemOpt = buildCandidateAuthorizationTimeline({
    visaStatus: "stem_opt",
    workAuthorization: "stem_opt",
    authorizationEndDate: "2027-10-13",
    roleRelatedToDegree: true,
    stemDegreeEligible: true,
    derivedFromDefaultsOnly: false,
    readFrom: ["profiles.visa_status"],
  })
  const h1b = buildCandidateAuthorizationTimeline({
    visaStatus: "h1b",
    workAuthorization: "h1b",
    authorizationEndDate: "2028-08-13",
    roleRelatedToDegree: true,
    stemDegreeEligible: true,
    derivedFromDefaultsOnly: false,
    readFrom: ["profiles.visa_status"],
  })

  assert.equal(stemOpt.canWorkForTargetEmployerWithoutNewImmigrationAction, "NEEDS_EMPLOYER_ACTION")
  assert.ok(stemOpt.futureEmployerActions.some((action) => action.type === "STEM_OPT_EVERIFY_PARTICIPATION" && action.status === "REQUIRED"))
  assert.equal(h1b.canWorkForTargetEmployerWithoutNewImmigrationAction, "NEEDS_EMPLOYER_ACTION")
  assert.deepEqual(h1b.futureEmployerActions.map((action) => action.type), ["H1B_TRANSFER"])
})
