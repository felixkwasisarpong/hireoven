import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveCanonicalCareersUrl,
  deriveCanonicalCareersUrlWithConfidence,
} from "@/lib/companies/canonical-careers-url"

test("deriveCanonicalCareersUrlWithConfidence: high from apply URLs majority", () => {
  const result = deriveCanonicalCareersUrlWithConfidence(
    {
      domain: "acme.com",
      careers_url: "",
      ats_type: null,
      ats_identifier: null,
    },
    {
      applyUrls: [
        "https://boards.greenhouse.io/acme/jobs/1",
        "https://boards.greenhouse.io/acme/jobs/2",
        "https://boards.greenhouse.io/acme/jobs/3",
      ],
    }
  )

  assert.equal(result.confidence, "high")
  assert.equal(result.url, "https://boards.greenhouse.io/acme")
  assert.equal(result.reason, "derived_from_apply_urls")
})

test("deriveCanonicalCareersUrlWithConfidence: high from curated KNOWN_DOMAIN_CAREERS", () => {
  const result = deriveCanonicalCareersUrlWithConfidence({
    domain: "stripe.com",
    careers_url: "https://stripe.com/about",
    ats_type: null,
    ats_identifier: null,
  })

  assert.equal(result.confidence, "high")
  assert.equal(result.url, "https://stripe.com/jobs")
  assert.equal(result.reason, "curated_known_domain")
})

test("deriveCanonicalCareersUrlWithConfidence: high from ats_identifier", () => {
  const result = deriveCanonicalCareersUrlWithConfidence({
    domain: "acme.com",
    careers_url: "",
    ats_type: "lever",
    ats_identifier: "acme",
  })

  assert.equal(result.confidence, "high")
  assert.equal(result.url, "https://jobs.lever.co/acme")
  assert.equal(result.reason, "derived_from_ats_identifier")
})

test("deriveCanonicalCareersUrlWithConfidence: medium when existing URL has careers/jobs path", () => {
  const result = deriveCanonicalCareersUrlWithConfidence({
    domain: "acme.com",
    careers_url: "https://acme.com/careers",
    ats_type: "custom",
    ats_identifier: null,
  })

  assert.equal(result.confidence, "medium")
  assert.equal(result.url, "https://acme.com/careers")
})

test("deriveCanonicalCareersUrlWithConfidence: low for synthetic fallback", () => {
  const result = deriveCanonicalCareersUrlWithConfidence({
    domain: "obscurecorp.test",
    careers_url: "",
    ats_type: null,
    ats_identifier: null,
  })

  assert.equal(result.confidence, "low")
  assert.equal(result.url, "https://obscurecorp.test/careers")
  assert.equal(result.reason, "synthetic_domain_fallback")
})

test("deriveCanonicalCareersUrlWithConfidence: low for plain HTTPS without listing keywords", () => {
  const result = deriveCanonicalCareersUrlWithConfidence({
    domain: "acme.com",
    careers_url: "https://acme.com/about",
    ats_type: "custom",
    ats_identifier: null,
  })

  assert.equal(result.confidence, "low")
  assert.equal(result.url, "https://acme.com/about")
})

test("deriveCanonicalCareersUrlWithConfidence: never returns a temporary share URL", () => {
  const result = deriveCanonicalCareersUrlWithConfidence({
    domain: "acme.com",
    careers_url: "https://boards.greenhouse.io/acme?validityToken=abc",
    ats_type: "greenhouse",
    ats_identifier: null,
  })

  // The validityToken URL fails normalizeAtsUrl, so we fall through to the
  // synthetic fallback (low) — never to the share URL.
  assert.notEqual(
    result.url,
    "https://boards.greenhouse.io/acme?validityToken=abc"
  )
  assert.notEqual(result.confidence, "high")
})

test("legacy deriveCanonicalCareersUrl still returns plain string", () => {
  const url = deriveCanonicalCareersUrl({
    domain: "stripe.com",
    careers_url: "",
    ats_type: null,
    ats_identifier: null,
  })
  assert.equal(typeof url, "string")
  assert.equal(url, "https://stripe.com/jobs")
})
