import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extractJsonLdBlocks, mapJsonLdToHarvestedJobs } from "./_json-ld"

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    "identifier": "12345",
    "title": "Senior Backend Engineer",
    "description": "<p>Build great <b>things</b>.</p>",
    "hiringOrganization": { "name": "Acme Inc" },
    "jobLocation": {
      "@type": "Place",
      "address": {
        "addressLocality": "San Francisco",
        "addressRegion": "CA",
        "addressCountry": "US"
      }
    },
    "employmentType": "FULL_TIME",
    "datePosted": "2026-05-01T10:00:00Z",
    "url": "https://acme.bamboohr.com/careers/12345",
    "baseSalary": {
      "currency": "USD",
      "value": { "minValue": 150000, "maxValue": 200000, "unitText": "YEAR" }
    }
  }
  </script>
  <script type="application/ld+json">
  { "@type": "WebSite", "name": "Acme" }
  </script>
  <script type="application/ld+json">
  [
    { "@type": "JobPosting", "title": "Eng Manager", "url": "https://acme.bamboohr.com/careers/67890", "identifier": "67890", "datePosted": "2026-05-02" },
    { "@type": "JobPosting", "title": "PM", "url": "https://acme.bamboohr.com/careers/55555", "identifier": "55555", "jobLocationType": "TELECOMMUTE" }
  ]
  </script>
</head></html>`

test("extractJsonLdBlocks: pulls every ld+json script block", () => {
  const blocks = extractJsonLdBlocks(SAMPLE_HTML)
  assert.equal(blocks.length, 4) // 1 object + 1 WebSite + 2 from array
})

test("extractJsonLdBlocks: tolerates invalid JSON without throwing", () => {
  const html = `<script type="application/ld+json">{ not: valid }</script>`
  const blocks = extractJsonLdBlocks(html)
  assert.equal(blocks.length, 0)
})

test("mapJsonLdToHarvestedJobs: maps JobPosting fields, ignores WebSite", () => {
  const blocks = extractJsonLdBlocks(SAMPLE_HTML)
  const jobs = mapJsonLdToHarvestedJobs(blocks, { sourceAts: "bamboohr" })
  assert.equal(jobs.length, 3)

  const first = jobs[0]
  assert.equal(first.externalId, "bamboohr:12345")
  assert.equal(first.title, "Senior Backend Engineer")
  assert.equal(first.applyUrl, "https://acme.bamboohr.com/careers/12345")
  assert.equal(first.location, "San Francisco, CA, US")
  assert.equal(first.postedAt, "2026-05-01T10:00:00.000Z")
  assert.equal(first.employmentType, "FULL_TIME")
  assert.equal(first.salaryMin, 150000)
  assert.equal(first.salaryMax, 200000)
  assert.equal(first.salaryCurrency, "USD")
  assert.ok(first.description?.includes("Build great"))
  assert.match(first.contentHash, /^[0-9a-f]{32}$/)
})

test("mapJsonLdToHarvestedJobs: detects remote from jobLocationType", () => {
  const blocks = extractJsonLdBlocks(SAMPLE_HTML)
  const jobs = mapJsonLdToHarvestedJobs(blocks, { sourceAts: "bamboohr" })
  const remote = jobs.find((j) => j.externalId === "bamboohr:55555")
  assert.ok(remote)
  assert.equal(remote!.workMode, "remote")
})

test("mapJsonLdToHarvestedJobs: dedupes by externalId within a single page", () => {
  const blocks = [
    { "@type": "JobPosting", title: "X", url: "https://example.com/1", identifier: "1" },
    { "@type": "JobPosting", title: "X", url: "https://example.com/1", identifier: "1" },
  ]
  const jobs = mapJsonLdToHarvestedJobs(blocks, { sourceAts: "bamboohr" })
  assert.equal(jobs.length, 1)
})

test("mapJsonLdToHarvestedJobs: skips JobPostings without title or URL", () => {
  const blocks = [
    { "@type": "JobPosting", title: "", url: "https://example.com/1" },
    { "@type": "JobPosting", title: "Engineer" }, // no url
  ]
  const jobs = mapJsonLdToHarvestedJobs(blocks, { sourceAts: "bamboohr" })
  assert.equal(jobs.length, 0)
})

test("mapJsonLdToHarvestedJobs: uses fallbackUrl when JobPosting has no url", () => {
  const blocks = [
    { "@type": "JobPosting", title: "Engineer", identifier: "99" },
  ]
  const jobs = mapJsonLdToHarvestedJobs(blocks, {
    sourceAts: "bamboohr",
    fallbackUrl: "https://acme.bamboohr.com/careers",
  })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].applyUrl, "https://acme.bamboohr.com/careers")
})

test("mapJsonLdToHarvestedJobs: rejects non-annual salary units", () => {
  const blocks = [
    {
      "@type": "JobPosting",
      title: "Engineer",
      url: "https://example.com/1",
      identifier: "1",
      baseSalary: {
        currency: "USD",
        value: { minValue: 50, maxValue: 80, unitText: "HOUR" },
      },
    },
  ]
  const jobs = mapJsonLdToHarvestedJobs(blocks, { sourceAts: "bamboohr" })
  assert.equal(jobs[0].salaryMin, undefined)
  assert.equal(jobs[0].salaryMax, undefined)
})
