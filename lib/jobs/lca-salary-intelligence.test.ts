import test from "node:test"
import assert from "node:assert/strict"
import { calculateLcaSalaryIntelligence } from "@/lib/jobs/lca-salary-intelligence"
import type { LcaWageRecord } from "@/types"

const records: LcaWageRecord[] = [
  {
    employerName: "Acme",
    jobTitle: "Software Engineer",
    roleFamily: "software engineer",
    location: "New York, NY",
    worksiteState: "NY",
    wageRateFrom: 120_000,
    wageRateTo: 140_000,
    wageUnit: "Year",
    wageLevel: "Level II",
    fiscalYear: 2025,
  },
  {
    employerName: "Acme",
    jobTitle: "Senior Software Engineer",
    roleFamily: "software engineer",
    location: "New York, NY",
    worksiteState: "NY",
    wageRateFrom: 150_000,
    wageRateTo: 175_000,
    wageUnit: "Year",
    wageLevel: "Level III",
    fiscalYear: 2025,
  },
  {
    employerName: "Acme",
    jobTitle: "Staff Software Engineer",
    roleFamily: "software engineer",
    location: "New York, NY",
    worksiteState: "NY",
    wageRateFrom: 180_000,
    wageRateTo: 210_000,
    wageUnit: "Year",
    wageLevel: "Level III",
    fiscalYear: 2024,
  },
]

test("calculateLcaSalaryIntelligence labels listed salary inside historical range as aligned", () => {
  const result = calculateLcaSalaryIntelligence({
    salaryMin: 145_000,
    salaryMax: 170_000,
    jobTitle: "Senior Software Engineer",
    companyName: "Acme",
    location: "New York",
    roleFamily: "software engineer",
    records,
  })

  assert.equal(result.comparisonLabel, "Aligned")
  assert.equal(result.position, "within_range")
  assert.equal(result.historicalRangeMin, 120_000)
  assert.equal(result.historicalRangeMax, 210_000)
  assert.equal(result.medianWage, 162_500)
  assert.equal(result.commonWageLevel, "Level III")
  assert.equal(result.comparableLcaCount, 3)
  assert.match(result.explanation, /overlaps/i)
})

test("calculateLcaSalaryIntelligence labels listed salary below historical range", () => {
  const result = calculateLcaSalaryIntelligence({
    salaryMin: 85_000,
    salaryMax: 95_000,
    jobTitle: "Software Engineer",
    companyName: "Acme",
    location: "New York",
    roleFamily: "software engineer",
    records,
  })

  assert.equal(result.comparisonLabel, "Below Market")
  assert.equal(result.position, "below_range")
  assert.ok((result.salaryFitScore ?? 0) < 50)
  assert.match(result.explanation, /below/i)
})

test("calculateLcaSalaryIntelligence gracefully handles missing listed salary", () => {
  const result = calculateLcaSalaryIntelligence({
    salaryMin: null,
    salaryMax: null,
    jobTitle: "Software Engineer",
    companyName: "Acme",
    records,
  })

  assert.equal(result.comparisonLabel, "Unknown")
  assert.equal(result.confidence, "low")
  assert.equal(result.historicalRangeMin, null)
  assert.match(result.explanation, /salary is missing/i)
})

test("calculateLcaSalaryIntelligence gracefully handles missing LCA records", () => {
  const result = calculateLcaSalaryIntelligence({
    salaryMin: 130_000,
    salaryMax: 160_000,
    jobTitle: "Software Engineer",
    companyName: "Unknown Co",
    records: [],
  })

  assert.equal(result.comparisonLabel, "Unknown")
  assert.equal(result.confidence, "low")
  assert.equal(result.comparableLcaCount, 0)
  assert.match(result.explanation, /No comparable LCA wage records/i)
})

