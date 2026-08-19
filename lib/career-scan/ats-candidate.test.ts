import assert from "node:assert/strict"
import test from "node:test"
import {
  atsIdentifierFor,
  boardScore,
  extractUrlsFromHtml,
  findAtsCandidate,
  isAssetUrl,
  safeUrl,
} from "@/lib/career-scan/ats-candidate"

test("isAssetUrl rejects vendor CDN hosts and static files", () => {
  for (const u of [
    "https://cdn.phenompeople.com/",
    "https://assets.phenompeople.com/x.png",
    "https://cdn-prod-static.phenompeople.com/a/b.js",
    "https://static.example.com/app.css",
    "https://boards.greenhouse.io/logo.svg",
  ]) {
    assert.equal(isAssetUrl(safeUrl(u)!), true, u)
  }
})

test("isAssetUrl keeps real ATS board URLs", () => {
  for (const u of [
    "https://frostbank.wd5.myworkdayjobs.com/external/login",
    "https://boards.greenhouse.io/acme",
    "https://jobs.lever.co/acme",
    "https://job-boards.greenhouse.io/acme",
    "https://jobs.smartrecruiters.com/acme",
  ]) {
    assert.equal(isAssetUrl(safeUrl(u)!), false, u)
  }
})

test("boardScore prefers job-bearing paths over bare vendor roots", () => {
  const root = boardScore(safeUrl("https://cdn.phenompeople.com/")!)
  const board = boardScore(safeUrl("https://boards.greenhouse.io/acme/jobs")!)
  assert.ok(board > root)
})

// The Frost Bank regression: a Phenom-fronted career site whose <head> loads
// ~28 cdn.phenompeople.com assets (each detected as ATS "phenom") and whose real
// board — Workday — is linked once, far down the body. First-match-wins picked
// the CDN root and scanned it, returning zero jobs.
test("findAtsCandidate skips vendor CDN assets and finds the real board", () => {
  const html = `
    <html><head>
      <link rel="stylesheet" href="https://cdn.phenompeople.com/CareerConnectResources/main.css">
      <script src="https://cdn.phenompeople.com/CareerConnectResources/app.js"></script>
      <link rel="icon" href="https://assets.phenompeople.com/favicon.ico">
    </head><body>
      <a href="/us/en/about">About</a>
      <a href="https://frostbank.wd5.myworkdayjobs.com/external/login">Sign in</a>
    </body></html>`

  const urls = extractUrlsFromHtml(html, "https://careers.frostbank.com/us/en/c/technology-digital-jobs")
  const candidate = findAtsCandidate(urls)

  assert.ok(candidate, "expected an ATS candidate")
  assert.equal(candidate.detection.atsType, "workday")
  assert.equal(candidate.url, "https://frostbank.wd5.myworkdayjobs.com/external/login")
})

test("findAtsCandidate returns the canonical adapter slug, not a host fragment", () => {
  const candidate = findAtsCandidate(["https://frostbank.wd5.myworkdayjobs.com/external/login"])
  // "frostbank" alone is not a usable Workday board identifier — parseSlug needs
  // tenant:wd:site, and this value is persisted onto the company + ats_tenants.
  assert.equal(candidate?.identifier, "frostbank:wd5:external")
})

test("atsIdentifierFor keeps an explicitly detected identifier", () => {
  const id = atsIdentifierFor("https://boards.greenhouse.io/acme", {
    atsType: "greenhouse",
    atsIdentifier: "acme",
    confidence: "high",
  })
  assert.equal(id, "acme")
})

test("findAtsCandidate returns null when a page has no ATS links", () => {
  const html = `<a href="https://example.com/about">About</a><img src="https://cdn.example.com/a.png">`
  assert.equal(findAtsCandidate(extractUrlsFromHtml(html, "https://example.com")), null)
})

test("a page whose only ATS reference is a CDN asset yields no candidate", () => {
  const html = `<script src="https://cdn.phenompeople.com/x/y.js"></script>`
  assert.equal(findAtsCandidate(extractUrlsFromHtml(html, "https://careers.example.com")), null)
})
