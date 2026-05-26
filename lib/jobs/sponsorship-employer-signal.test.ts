import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  effectiveEmployerSponsorshipScore,
  employerLikelySponsorsH1b,
  resolveH1BSponsorshipDisplay,
} from "./sponsorship-employer-signal"
import type { Company, Job } from "@/types"

const baseCompany: Company = {
  id: "company-1",
  name: "Agency Corp",
  domain: "agency.example.com",
  logo_url: null,
  industry: null,
  size: null,
  careers_url: "https://agency.example.com/careers",
  ats_type: null,
  ats_identifier: null,
  is_active: true,
  last_crawled_at: null,
  job_count: 0,
  notes: null,
  raw_ats_config: null,
  h1b_sponsor_count_1yr: 40,
  h1b_sponsor_count_3yr: 120,
  sponsors_h1b: true,
  sponsorship_confidence: 91,
  immigration_profile_summary: null,
  hiring_health: null,
  health_score: null,
  health_verdict: null,
  glassdoor_rating: null,
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
}

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: "job-1",
    company_id: "company-1",
    title: "Software Engineer",
    department: null,
    location: "Remote, US",
    is_remote: true,
    is_hybrid: false,
    employment_type: "fulltime",
    seniority_level: "senior",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    description: "Build distributed systems.",
    apply_url: "https://example.com/jobs/1",
    external_id: "ext-1",
    first_detected_at: "2026-05-20T00:00:00.000Z",
    last_seen_at: "2026-05-20T00:00:00.000Z",
    is_active: true,
    sponsors_h1b: null,
    sponsorship_score: 0,
    visa_language_detected: null,
    requires_authorization: false,
    skills: [],
    normalized_title: "Software Engineer",
    raw_data: null,
    h1b_prediction: null,
    h1b_prediction_at: null,
    job_intelligence: null,
    ghost_risk_score: null,
    ghost_risk_level: null,
    created_at: "2026-05-20T00:00:00.000Z",
    updated_at: "2026-05-20T00:00:00.000Z",
    ...overrides,
  }
}

test("staffing intermediary suppresses company-level sponsorship inflation", () => {
  const job = makeJob({
    raw_data: {
      hiring_entity: {
        display_name: "Pinterest",
        end_client_name: "Pinterest",
        staffing_company_name: "Agency Corp",
        is_staffing_intermediary: true,
        confidence: 0.84,
        source: "our_client",
      },
    },
  })

  const withCompany = { ...job, company: baseCompany }

  assert.equal(employerLikelySponsorsH1b(withCompany), false)
  assert.equal(effectiveEmployerSponsorshipScore(withCompany), 0)
  assert.equal(resolveH1BSponsorshipDisplay(withCompany), null)
})

test("non-staffing listings still use company sponsorship signals", () => {
  const job = makeJob({})
  const withCompany = { ...job, company: baseCompany }

  assert.equal(employerLikelySponsorsH1b(withCompany), true)
  assert.equal(effectiveEmployerSponsorshipScore(withCompany), 91)
  assert.equal(resolveH1BSponsorshipDisplay(withCompany)?.label, "H-1B sponsor")
})
