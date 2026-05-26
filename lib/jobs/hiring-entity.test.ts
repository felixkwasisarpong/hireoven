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
