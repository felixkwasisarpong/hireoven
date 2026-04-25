import test from "node:test"
import assert from "node:assert/strict"
import {
  calculateOptTimelineDashboard,
  createOptTimelineSettingsFromProfile,
} from "@/lib/immigration/opt-timeline"

test("calculateOptTimelineDashboard returns low urgency for a healthy OPT timeline", () => {
  const result = calculateOptTimelineDashboard({
    immigrationStatus: "F1_OPT",
    optStartDate: "2026-01-01",
    optEndDate: "2026-12-31",
    stemOptStartDate: null,
    stemOptEndDate: null,
    unemploymentDaysUsed: 10,
    currentEmploymentStatus: "employed",
    targetWeeklyApplicationGoal: 15,
    asOf: "2026-06-01",
  })

  assert.equal(result.currentAuthorizationPeriod, "OPT")
  assert.equal(result.daysRemaining, 213)
  assert.equal(result.unemploymentDaysUsed, 10)
  assert.equal(result.estimatedUnemploymentDaysRemaining, 80)
  assert.equal(result.urgencyLevel, "Low")
  assert.equal(result.recommendedWeeklyApplicationTarget, 15)
  assert.match(result.disclaimer, /not legal advice/i)
})

test("calculateOptTimelineDashboard raises emergency when unemployment days are nearly exhausted", () => {
  const result = calculateOptTimelineDashboard({
    immigrationStatus: "F1_OPT",
    optStartDate: "2026-01-01",
    optEndDate: "2026-10-01",
    stemOptStartDate: null,
    stemOptEndDate: null,
    unemploymentDaysUsed: 86,
    currentEmploymentStatus: "unemployed",
    targetWeeklyApplicationGoal: 20,
    asOf: "2026-07-01",
  })

  assert.equal(result.estimatedUnemploymentDaysRemaining, 4)
  assert.equal(result.urgencyLevel, "Emergency")
  assert.equal(result.recommendedWeeklyApplicationTarget, 60)
  assert.ok(result.warnings.some((warning) => /DSO/i.test(warning)))
})

test("calculateOptTimelineDashboard tracks STEM OPT using the larger unemployment limit", () => {
  const result = calculateOptTimelineDashboard({
    immigrationStatus: "F1_STEM_OPT",
    optStartDate: "2025-01-01",
    optEndDate: "2025-12-31",
    stemOptStartDate: "2026-01-01",
    stemOptEndDate: "2027-12-31",
    unemploymentDaysUsed: 100,
    currentEmploymentStatus: "employed",
    targetWeeklyApplicationGoal: 30,
    asOf: "2026-12-31",
  })

  assert.equal(result.currentAuthorizationPeriod, "STEM_OPT")
  assert.equal(result.unemploymentDaysLimit, 150)
  assert.equal(result.estimatedUnemploymentDaysRemaining, 50)
  assert.equal(result.urgencyLevel, "Low")
})

test("calculateOptTimelineDashboard applies manual overrides cautiously", () => {
  const result = calculateOptTimelineDashboard({
    immigrationStatus: "F1_OPT",
    optStartDate: "2026-01-01",
    optEndDate: "2026-12-31",
    stemOptStartDate: null,
    stemOptEndDate: null,
    unemploymentDaysUsed: 20,
    currentEmploymentStatus: "employed",
    targetWeeklyApplicationGoal: 10,
    manualOverrides: {
      daysRemaining: 12,
      unemploymentDaysRemaining: 6,
      urgencyLevel: "Emergency",
    },
    asOf: "2026-02-01",
  })

  assert.equal(result.daysRemaining, 12)
  assert.equal(result.estimatedUnemploymentDaysRemaining, 6)
  assert.equal(result.urgencyLevel, "Emergency")
  assert.ok(result.assumptions.some((assumption) => /Manual override/i.test(assumption)))
})

test("createOptTimelineSettingsFromProfile maps existing profile fields into the placeholder integration point", () => {
  const settings = createOptTimelineSettingsFromProfile({
    is_international: true,
    visa_status: "stem_opt",
    opt_end_date: "2025-12-31",
    opt_timeline_settings: {
      immigrationStatus: "F1_STEM_OPT",
      optStartDate: "2025-01-01",
      optEndDate: "2025-12-31",
      stemOptStartDate: "2026-01-01",
      stemOptEndDate: "2027-12-31",
      unemploymentDaysUsed: 35,
      currentEmploymentStatus: "employed",
      targetWeeklyApplicationGoal: 25,
    },
  })

  assert.equal(settings.immigrationStatus, "F1_STEM_OPT")
  assert.equal(settings.stemOptEndDate, "2027-12-31")
  assert.equal(settings.unemploymentDaysUsed, 35)
  assert.equal(settings.targetWeeklyApplicationGoal, 25)
})
