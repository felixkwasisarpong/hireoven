import { strict as assert } from "node:assert"
import { test } from "node:test"
import { sitemapJsonLdAdapter } from "./sitemap-jsonld"

const HOST = "https://careers.example.com"
const jobPage = (id: string, title: string, city: string) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title,
    identifier: { "@type": "PropertyValue", name: "Example", value: id },
    datePosted: "2026-03-20",
    employmentType: ["FULL_TIME"],
    hiringOrganization: { "@type": "Organization", name: "Example" },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: city, addressRegion: "GA" } },
    description: "Do great things.",
    url: `${HOST}/us/en`, // generic — adapter must ignore this in favor of the sitemap URL
  })}</script></head><body></body></html>`

// Routes: index → 2 sub-sitemaps → 2 job URLs each (one is a non-job URL to filter).
function makeFetch(): typeof fetch {
  return (async (input: string) => {
    const url = String(input)
    if (url.includes("sitemap_index.xml")) {
      return new Response(
        `<sitemapindex><sitemap><loc>${HOST}/us/en/sitemap1.xml</loc></sitemap><sitemap><loc>${HOST}/us/en/sitemap2.xml</loc></sitemap></sitemapindex>`,
        { headers: { "content-type": "application/xml" } }
      )
    }
    if (url.endsWith("sitemap1.xml")) {
      return new Response(
        `<urlset><url><loc>${HOST}/us/en/job/R100/engineer</loc></url><url><loc>${HOST}/us/en/about</loc></url></urlset>`,
        { headers: { "content-type": "application/xml" } }
      )
    }
    if (url.endsWith("sitemap2.xml")) {
      return new Response(
        `<urlset><url><loc>${HOST}/us/en/job/R101/driver</loc></url></urlset>`,
        { headers: { "content-type": "application/xml" } }
      )
    }
    if (url.includes("/job/R100/")) return new Response(jobPage("R100", "Software Engineer", "Atlanta"), { headers: { "content-type": "text/html" } })
    if (url.includes("/job/R101/")) return new Response(jobPage("R101", "Package Driver", "Dallas"), { headers: { "content-type": "text/html" } })
    return new Response("not found", { status: 404 })
  }) as unknown as typeof fetch
}

test("sitemapjsonld: detectFromUrl returns null (enrolled by ats_type)", () => {
  assert.equal(sitemapJsonLdAdapter.detectFromUrl("https://careers.example.com/x"), null)
})

test("sitemapjsonld: enumerates sitemap index → job pages → JSON-LD jobs", async () => {
  const result = await sitemapJsonLdAdapter.fetchJobs({
    slug: `${HOST}/us/en/sitemap_index.xml`,
    ctx: { etag: null, lastModified: null, fetchImpl: makeFetch() },
  })
  assert.equal(result.sourceAts, "sitemapjsonld")
  assert.equal(result.notModified, false)
  assert.equal(result.jobs.length, 2) // /about filtered out, 2 job pages parsed
  const byTitle = Object.fromEntries(result.jobs.map((j) => [j.title, j]))
  assert.ok(byTitle["Software Engineer"])
  assert.ok(byTitle["Package Driver"])
  // apply URL is the sitemap job page (not the generic JSON-LD url)
  assert.equal(byTitle["Software Engineer"].applyUrl, `${HOST}/us/en/job/R100/engineer`)
  assert.equal(byTitle["Software Engineer"].externalId, "sitemapjsonld:R100")
  assert.equal(byTitle["Software Engineer"].location, "Atlanta, GA")
  assert.equal(byTitle["Software Engineer"].employmentType, "FULL_TIME")
})

test("sitemapjsonld: 304 on the sitemap → notModified, no jobs", async () => {
  const fetchImpl = (async () => new Response(null, { status: 304 })) as unknown as typeof fetch
  const result = await sitemapJsonLdAdapter.fetchJobs({
    slug: `${HOST}/us/en/sitemap_index.xml`,
    ctx: { etag: '"abc"', lastModified: null, fetchImpl },
  })
  assert.equal(result.notModified, true)
  assert.equal(result.jobs.length, 0)
})

test("sitemapjsonld: throws when the sitemap request errors", async () => {
  const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
  await assert.rejects(
    sitemapJsonLdAdapter.fetchJobs({ slug: `${HOST}/sitemap_index.xml`, ctx: { etag: null, lastModified: null, fetchImpl } }),
    /sitemapjsonld sitemap fetch failed/
  )
})
