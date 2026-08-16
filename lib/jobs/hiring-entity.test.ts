import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  extractLikelyHiringEntityFromDescription,
  isStaffingIntermediaryListing,
  readHiringEntitySignalFromRawData,
  resolveDisplayCompanyName,
  resolveHiringEntitySignal,
} from "./hiring-entity"

test("extractLikelyHiringEntityFromDescription: extracts explicit end-client name", () => {
  const result = extractLikelyHiringEntityFromDescription(
    "Role overview: End client: Stripe. You will build backend services."
  )

  assert.equal(result?.name, "Stripe")
  assert.equal(result?.source, "end_client_label")
})

test("extractLikelyHiringEntityFromDescription: strips recruiter CTA text from client name", () => {
  const result = extractLikelyHiringEntityFromDescription(
    "End client: Anaplan, please send an email with your resume and availability."
  )

  assert.equal(result?.name, "Anaplan")
})

test("extractLikelyHiringEntityFromDescription: ignores compound words like client-side", () => {
  // The hyphen in "client-side" must not be read as a "client: <value>" separator.
  const result = extractLikelyHiringEntityFromDescription(
    "Experience building server-side (e.g., Go, C++) and client-side (e.g., TypeScript) layers."
  )

  assert.equal(result, null)
})

test("extractLikelyHiringEntityFromDescription: ignores plural 'clients' phrases", () => {
  // "for our clients and communities" must NOT be read as "for our client, <name>".
  const result = extractLikelyHiringEntityFromDescription(
    "We build technology that delivers value for our clients and communities every day."
  )

  assert.equal(result, null)
})

test("resolveHiringEntitySignal: plural 'clients' phrase is not a staffing intermediary", () => {
  const signal = resolveHiringEntitySignal({
    companyName: "Rbc",
    description:
      "As a Lead Software Engineer you will deliver platforms for our clients and communities.",
  })

  assert.equal(signal, null)
})

test("extractLikelyHiringEntityFromDescription: rejects connective-led fragments", () => {
  // Singular "client" followed by a connective is a fragment, not a client name.
  const result = extractLikelyHiringEntityFromDescription(
    "We support our client and the broader community across the region."
  )

  assert.equal(result, null)
})

test("resolveHiringEntitySignal: marks staffing intermediary when client differs", () => {
  const signal = resolveHiringEntitySignal({
    companyName: "Acme Talent Solutions",
    description:
      "For our client, Pinterest, we are hiring a Senior Data Engineer. W2 contract role.",
  })

  assert.equal(signal?.is_staffing_intermediary, true)
  assert.equal(signal?.display_name, "Pinterest")
  assert.equal(signal?.end_client_name, "Pinterest")
  assert.equal(signal?.staffing_company_name, "Acme Talent Solutions")
})

test("resolveHiringEntitySignal: returns null when no intermediary evidence exists", () => {
  const signal = resolveHiringEntitySignal({
    companyName: "Stripe",
    description: "Stripe is hiring a backend engineer to join the billing platform team.",
  })

  assert.equal(signal, null)
})

test("readHiringEntitySignalFromRawData + resolveDisplayCompanyName", () => {
  const rawData = {
    hiring_entity: {
      display_name: "NVIDIA",
      end_client_name: "NVIDIA",
      staffing_company_name: "Tech Recruiters LLC",
      is_staffing_intermediary: true,
      confidence: 0.82,
      source: "our_client",
    },
  }

  const signal = readHiringEntitySignalFromRawData(rawData)
  assert.equal(signal?.display_name, "NVIDIA")
  assert.equal(isStaffingIntermediaryListing({ rawData }), true)
  assert.equal(
    resolveDisplayCompanyName({ companyName: "Tech Recruiters LLC", rawData }),
    "NVIDIA"
  )
})

test("resolveDisplayCompanyName: strips stored recruiter CTA text", () => {
  const rawData = {
    hiring_entity: {
      display_name: "Anaplan, please send an email",
      end_client_name: "Anaplan, please send an email",
      staffing_company_name: "Acme Talent Solutions",
      is_staffing_intermediary: true,
      confidence: 0.82,
      source: "end_client_label",
    },
  }

  assert.equal(
    resolveDisplayCompanyName({ companyName: "Acme Talent Solutions", rawData }),
    "Anaplan"
  )
})

// ── structured_job fallback ───────────────────────────────────────────────────
// normalize.ts sets `hiringCompany` to the employer's own name whenever there is
// no hiring-entity signal, so its presence must never imply an intermediary.

test("structured_job fallback: direct employer is NOT a staffing intermediary", () => {
  const rawData = {
    structured_job: {
      company: "Mercury Logistics Group",
      hiringCompany: "Mercury Logistics Group",
      staffingCompany: null,
      staffingIntermediary: false,
    },
  }
  assert.equal(isStaffingIntermediaryListing({ rawData }), false)
  assert.equal(readHiringEntitySignalFromRawData(rawData)?.is_staffing_intermediary, false)
})

test("structured_job fallback: hiringCompany alone does not imply staffing", () => {
  // No explicit flag and no board name to compare against — previously this
  // returned is_staffing_intermediary: true and discarded company sponsorship.
  const rawData = { structured_job: { hiringCompany: "Stripe" } }
  assert.equal(isStaffingIntermediaryListing({ rawData }), false)
  assert.equal(readHiringEntitySignalFromRawData(rawData)?.display_name, "Stripe")
})

test("structured_job fallback: honours an explicit staffingIntermediary flag", () => {
  const rawData = {
    structured_job: {
      company: "Acme Talent Solutions",
      hiringCompany: "Pinterest",
      staffingCompany: "Acme Talent Solutions",
      staffingIntermediary: true,
    },
  }
  assert.equal(isStaffingIntermediaryListing({ rawData }), true)
  const signal = readHiringEntitySignalFromRawData(rawData)
  assert.equal(signal?.end_client_name, "Pinterest")
  assert.equal(signal?.staffing_company_name, "Acme Talent Solutions")
})

test("structured_job fallback: infers staffing when hiring company differs from the board", () => {
  const rawData = {
    structured_job: {
      company: "Acme Talent Solutions",
      hiringCompany: "Pinterest",
      staffingIntermediary: false,
    },
  }
  assert.equal(isStaffingIntermediaryListing({ rawData }), true)
  const signal = readHiringEntitySignalFromRawData(rawData)
  assert.equal(signal?.end_client_name, "Pinterest")
  assert.equal(signal?.staffing_company_name, "Acme Talent Solutions")
})

test("structured_job fallback: name comparison ignores case", () => {
  const rawData = {
    structured_job: { company: "Mercury", hiringCompany: "mercury", staffingIntermediary: false },
  }
  assert.equal(isStaffingIntermediaryListing({ rawData }), false)
})
