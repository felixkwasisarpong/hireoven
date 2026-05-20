import { strict as assert } from "node:assert"
import { test } from "node:test"
import { decodeSlug, encodeSlug, extractJobLinks, parseTenant, taleoAdapter } from "./taleo"

test("taleo: detectFromUrl extracts tenant + section", () => {
  assert.deepEqual(
    taleoAdapter.detectFromUrl("https://marriott.taleo.net/careersection/2/jobsearch.ftl?lang=en"),
    { slug: "marriott:2" }
  )
})

test("taleo: detectFromUrl accepts named section codes (executive_careers, etc.)", () => {
  assert.deepEqual(
    taleoAdapter.detectFromUrl(
      "https://example.taleo.net/careersection/executive_careers/jobdetail.ftl?job=ABC"
    ),
    { slug: "example:executive_careers" }
  )
})

test("taleo: detectFromUrl rejects non-Taleo / infrastructure subdomains", () => {
  assert.equal(taleoAdapter.detectFromUrl("https://www.taleo.net/"), null)
  assert.equal(taleoAdapter.detectFromUrl("https://tbe.taleo.net/customer"), null)
  assert.equal(taleoAdapter.detectFromUrl("https://example.com/careersection/2/jobsearch.ftl"), null)
  assert.equal(
    taleoAdapter.detectFromUrl("https://acme.taleo.net/something-else/2/jobsearch.ftl"),
    null
  )
})

test("taleo: parseTenant filters known infrastructure subdomains", () => {
  assert.equal(parseTenant("marriott.taleo.net"), "marriott")
  assert.equal(parseTenant("www.taleo.net"), null)
  assert.equal(parseTenant("tbe.taleo.net"), null)
  assert.equal(parseTenant("example.com"), null)
})

test("taleo: slug encode / decode round-trips", () => {
  const slug = encodeSlug("marriott", "2")
  assert.equal(slug, "marriott:2")
  const decoded = decodeSlug(slug)
  assert.deepEqual(decoded, { tenant: "marriott", section: "2" })
  assert.equal(decodeSlug("marriott"), null)
  assert.equal(decodeSlug("www:2"), null)
})

test("taleo: extractJobLinks parses jobdetail.ftl anchors", () => {
  const html = `
    <table>
      <tr>
        <td><a href="jobdetail.ftl?job=210000R3&amp;lang=en">Senior Engineer</a></td>
      </tr>
      <tr>
        <td><a href="https://marriott.taleo.net/careersection/2/jobdetail.ftl?job=2200012A">Product Manager</a></td>
      </tr>
      <tr>
        <td><a href="jobdetail.ftl?job=210000R3">Senior Engineer (dup)</a></td>
      </tr>
      <tr>
        <td><a href="jobsearch.ftl?lang=en&amp;pageNo=2">Next</a></td>
      </tr>
      <tr>
        <td><a href="https://example.com/jobdetail.ftl?job=999">External link</a></td>
      </tr>
    </table>
  `
  const links = extractJobLinks(html, "marriott", "2")
  assert.equal(links.length, 2)
  assert.equal(links[0].jobId, "210000R3")
  assert.equal(links[0].title, "Senior Engineer")
  assert.equal(
    links[0].url,
    "https://marriott.taleo.net/careersection/2/jobdetail.ftl?job=210000R3&lang=en"
  )
  assert.equal(links[1].jobId, "2200012A")
})

test("taleo: ctx.alreadyDescribedIds excludes those jobs from detail fetching", async () => {
  // Two jobs on the listing. Only AAA needs a description (BBB is in the
  // alreadyDescribedIds set); the adapter should never request detailHtml
  // for BBB.
  const page1 = `<a href="jobdetail.ftl?job=AAA">Engineer</a>
                 <a href="jobdetail.ftl?job=BBB">Designer</a>`
  const detailA = `
    <script type="application/ld+json">
      {"@context":"http://schema.org","@type":"JobPosting","title":"Engineer",
       "description":"Real description for AAA only.",
       "identifier":"AAA"}
    </script>
  `

  const detailFetchedFor: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    if (url.pathname === "/careersection/2/jobsearch.ftl") {
      const page = url.searchParams.get("pageNo")
      if (page === "1") return new Response(page1)
      return new Response("") // no more jobs after page 1
    }
    if (url.pathname === "/careersection/2/jobdetail.ftl") {
      const jobId = url.searchParams.get("job") ?? ""
      detailFetchedFor.push(jobId)
      if (jobId === "AAA") return new Response(detailA)
      return new Response("<html></html>")
    }
    return new Response("", { status: 404 })
  }

  const result = await taleoAdapter.fetchJobs({
    slug: "marriott:2",
    ctx: {
      etag: null,
      lastModified: null,
      fetchImpl,
      // BBB already has a description in the "DB" — adapter must not refetch it.
      alreadyDescribedIds: new Set(["taleo:marriott:2:BBB"]),
    },
  })

  assert.deepEqual(detailFetchedFor, ["AAA"], "should have only fetched detail for AAA")
  assert.equal(result.jobs.length, 2, "both jobs still returned")
  const eng = result.jobs.find((j) => j.externalId.endsWith(":AAA"))
  assert.match(eng?.description ?? "", /Real description for AAA/)
  const des = result.jobs.find((j) => j.externalId.endsWith(":BBB"))
  // BBB is shallow — title from listing, no description (DB already has one).
  assert.equal(des?.description, undefined)
})

test("taleo: fetchJobs paginates 1-indexed and enriches detail JSON-LD", async () => {
  const page1 = `<a href="jobdetail.ftl?job=AAA">Engineer</a>`
  const page2 = `<a href="jobdetail.ftl?job=BBB">Designer</a>`
  const page3 = `<a href="jobdetail.ftl?job=AAA">Engineer (dup)</a>`
  const detailA = `
    <script type="application/ld+json">
      {
        "@context": "http://schema.org",
        "@type": "JobPosting",
        "title": "Engineer",
        "datePosted": "2026-05-15",
        "description": "<p>Build stuff.</p>",
        "jobLocation": {
          "@type": "Place",
          "address": { "addressLocality": "Bethesda", "addressRegion": "MD" }
        },
        "identifier": "AAA"
      }
    </script>
  `
  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    if (url.pathname === "/careersection/2/jobsearch.ftl") {
      const page = url.searchParams.get("pageNo")
      if (page === "1") return new Response(page1)
      if (page === "2") return new Response(page2)
      return new Response(page3)
    }
    if (url.pathname === "/careersection/2/jobdetail.ftl") {
      const job = url.searchParams.get("job")
      if (job === "AAA") return new Response(detailA)
      return new Response("<html></html>")
    }
    return new Response("", { status: 404 })
  }

  const result = await taleoAdapter.fetchJobs({
    slug: "marriott:2",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "taleo")
  assert.equal(result.sourceAtsSlug, "marriott:2")
  assert.equal(result.jobs.length, 2)
  const eng = result.jobs.find((j) => j.externalId.endsWith(":AAA"))
  assert.ok(eng)
  assert.equal(eng!.location, "Bethesda, MD")
  assert.equal(eng!.description, "Build stuff.")
  const des = result.jobs.find((j) => j.externalId.endsWith(":BBB"))
  assert.ok(des)
  assert.equal(des!.title, "Designer")
})
