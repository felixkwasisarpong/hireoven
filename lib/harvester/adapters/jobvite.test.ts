import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  extractJobLinks,
  extractPaginationUrls,
  jobviteAdapter,
} from "@/lib/harvester/adapters/jobvite"

test("jobvite: detectFromUrl resolves hosted company URLs", () => {
  assert.deepEqual(jobviteAdapter.detectFromUrl("https://jobs.jobvite.com/martinmarietta/jobs"), {
    slug: "martinmarietta",
  })
  assert.deepEqual(jobviteAdapter.detectFromUrl("https://jobs.jobvite.com/acme/job/o123abc"), {
    slug: "acme",
  })
})

test("jobvite: detectFromUrl rejects non-Jobvite hosts and malformed slugs", () => {
  assert.equal(jobviteAdapter.detectFromUrl("https://www.jobvite.com/support/job-seeker-support/"), null)
  assert.equal(jobviteAdapter.detectFromUrl("https://jobs.jobvite.com/-bad/jobs"), null)
})

test("jobvite: extractJobLinks reads server-rendered list anchors", () => {
  const html = `
    <ul class="jv-job-list">
      <li>
        <a class="flex-row" href="/acme/job/oP0AzfwI?__jvst=CareerSite">
          <div class="jv-job-list-name">Senior Data Engineer</div>
          <div class="ml-auto jv-job-list-location">Austin, Texas</div>
        </a>
      </li>
      <li>
        <a href="https://jobs.jobvite.com/acme/job/oS0AzfwL">
          <div class="jv-job-list-name">Product Manager</div>
          <div class="jv-job-list-location">Remote</div>
        </a>
      </li>
      <li><a href="/other/job/oSkip">Wrong slug</a></li>
    </ul>
  `

  assert.deepEqual(extractJobLinks(html, "acme"), [
    {
      jobId: "oP0AzfwI",
      title: "Senior Data Engineer",
      url: "https://jobs.jobvite.com/acme/job/oP0AzfwI",
      location: "Austin, Texas",
    },
    {
      jobId: "oS0AzfwL",
      title: "Product Manager",
      url: "https://jobs.jobvite.com/acme/job/oS0AzfwL",
      location: "Remote",
    },
  ])
})

test("jobvite: extractPaginationUrls follows same-board search pagination", () => {
  const html = `
    <a href="/acme/search/?p=1">Next</a>
    <a href="/acme/search/?p=2#results">2</a>
    <a href="/acme/search?c=Engineering&p=1">Category duplicate</a>
    <a href="/other/search/?p=1">Wrong slug</a>
  `
  assert.deepEqual(
    extractPaginationUrls(html, "acme", "https://jobs.jobvite.com/acme/search"),
    [
      "https://jobs.jobvite.com/acme/search/?p=1",
      "https://jobs.jobvite.com/acme/search/?p=2",
      "https://jobs.jobvite.com/acme/search?c=Engineering&p=1",
    ]
  )
})

test("jobvite: fetchJobs follows list pages and enriches detail JSON-LD", async () => {
  const listingHtml = `
    <a class="flex-row" href="/acme/job/o111">
      <div class="jv-job-list-name">Data Engineer</div>
      <div class="jv-job-list-location">Dallas, Texas</div>
    </a>
    <a href="/acme/search/?p=1">Next</a>
  `
  const pageTwoHtml = `
    <a class="flex-row" href="/acme/job/o222">
      <div class="jv-job-list-name">Product Designer</div>
      <div class="jv-job-list-location">Remote</div>
    </a>
  `
  const detailHtml = `
    <script type="application/ld+json">
      {
        "@context": "http://schema.org",
        "@type": "JobPosting",
        "datePosted": "2026-05-01",
        "description": "<p>Build data pipelines.</p>",
        "employmentType": "Full-Time",
        "identifier": "o111",
        "jobLocation": {
          "@type": "Place",
          "address": {
            "@type": "PostalAddress",
            "addressLocality": "Dallas",
            "addressRegion": "Texas",
            "addressCountry": "United States"
          }
        },
        "title": "Data Engineer"
      }
    </script>
  `

  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    const key = `${url.pathname}${url.search}`
    if (key === "/acme/jobs/all") return new Response(listingHtml)
    if (key === "/acme/search/?p=1") return new Response(pageTwoHtml)
    if (key === "/acme/job/o111") return new Response(detailHtml)
    return new Response("", { status: 404 })
  }

  const result = await jobviteAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "jobvite")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.notModified, false)
  assert.equal(result.jobs.length, 2)
  assert.equal(result.jobs[0]?.externalId, "jobvite:acme:o111")
  assert.equal(result.jobs[0]?.description, "Build data pipelines.")
  assert.equal(result.jobs[0]?.location, "Dallas, Texas, United States")
  assert.equal(result.jobs[1]?.externalId, "jobvite:acme:o222")
  assert.equal(result.jobs[1]?.location, "Remote")
})
