import test from "node:test"
import assert from "node:assert/strict"
import {
  classifyCareersPageHtml,
  discoverCareersUrl,
  scoreCareersUrl,
} from "@/lib/companies/careers-url-discovery"

test("scoreCareersUrl: high confidence for ATS host", () => {
  assert.equal(
    scoreCareersUrl("https://boards.greenhouse.io/example").confidence,
    "high"
  )
  assert.equal(
    scoreCareersUrl("https://jobs.lever.co/acme").confidence,
    "high"
  )
})

test("scoreCareersUrl: medium for path keyword on a non-ATS host", () => {
  const result = scoreCareersUrl("https://acme.com/careers")
  assert.equal(result.confidence, "medium")
})

test("scoreCareersUrl: low for plain HTTPS URL with no listing signals", () => {
  assert.equal(scoreCareersUrl("https://acme.com/").confidence, "low")
})

test("scoreCareersUrl: none for missing / invalid / temporary URLs", () => {
  assert.equal(scoreCareersUrl(null).confidence, "none")
  assert.equal(scoreCareersUrl("").confidence, "none")
  assert.equal(scoreCareersUrl("not a url").confidence, "none")
  assert.equal(
    scoreCareersUrl(
      "https://boards.greenhouse.io/example?validityToken=abc"
    ).confidence,
    "none"
  )
})

test("classifyCareersPageHtml: high when JSON-LD JobPosting present", () => {
  const html = `<html><body>
  <script type="application/ld+json">
    {"@type":"JobPosting","title":"Engineer"}
  </script>
  </body></html>`
  assert.equal(
    classifyCareersPageHtml({ url: "https://acme.com/careers", html })
      .confidence,
    "high"
  )
})

test("classifyCareersPageHtml: high when ATS host link present", () => {
  const html = `<html><body>
  <a href="https://boards.greenhouse.io/acme/jobs/1">Open role</a>
  </body></html>`
  assert.equal(
    classifyCareersPageHtml({ url: "https://acme.com/careers", html })
      .confidence,
    "high"
  )
})

test("classifyCareersPageHtml: medium with multiple job-shape anchors", () => {
  const html = `<html><body>
  <a href="/jobs/1">Engineer</a>
  <a href="/jobs/2">Designer</a>
  <a href="/jobs/3">Manager</a>
  </body></html>`
  const result = classifyCareersPageHtml({
    url: "https://acme.com/careers",
    html,
  })
  assert.equal(result.confidence, "medium")
})

test("classifyCareersPageHtml: low when no listing signals", () => {
  const html = `<html><body><h1>About us</h1><p>We are great.</p></body></html>`
  const result = classifyCareersPageHtml({
    url: "https://acme.com/careers",
    html,
  })
  assert.equal(result.confidence, "low")
})

test("discoverCareersUrl picks the highest-confidence candidate", async () => {
  const probe = async ({ url }: { url: string }) => {
    if (url.endsWith("/careers")) {
      return {
        ok: true,
        status: 200,
        html: '<html><body><a href="https://boards.greenhouse.io/acme/jobs/1">Engineer</a></body></html>',
      }
    }
    if (url.endsWith("/jobs")) {
      return {
        ok: true,
        status: 200,
        html: '<html><body><a href="/jobs/1">Engineer</a></body></html>',
      }
    }
    return { ok: false, status: 404, html: null }
  }

  const result = await discoverCareersUrl({ domain: "acme.com", probe })
  assert.equal(result.confidence, "high")
  assert.equal(result.url, "https://acme.com/careers")
  assert.equal(result.reason, "ats_host_link")
})

test("discoverCareersUrl returns none when every probe fails", async () => {
  const probe = async () => ({ ok: false, status: 404, html: null })
  const result = await discoverCareersUrl({ domain: "acme.com", probe })
  assert.equal(result.confidence, "none")
})

test("discoverCareersUrl falls back to medium when no high-confidence candidate found", async () => {
  const probe = async ({ url }: { url: string }) => {
    if (url.endsWith("/work-with-us")) {
      return {
        ok: true,
        status: 200,
        html: '<html><body><a href="/jobs/a">A</a><a href="/jobs/b">B</a><a href="/jobs/c">C</a></body></html>',
      }
    }
    return { ok: false, status: 404, html: null }
  }
  const result = await discoverCareersUrl({ domain: "acme.com", probe })
  assert.equal(result.confidence, "medium")
  assert.equal(result.url, "https://acme.com/work-with-us")
})

test("discoverCareersUrl normalizes domain (strips www, lowercases)", async () => {
  const seen: string[] = []
  const probe = async ({ url }: { url: string }) => {
    seen.push(url)
    return { ok: false, status: 404, html: null }
  }
  await discoverCareersUrl({
    domain: "WWW.Acme.COM",
    probe,
    maxAttempts: 1,
  })
  assert.ok(seen.every((url) => url.startsWith("https://acme.com")))
})
