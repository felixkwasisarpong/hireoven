/**
 * Dev-only test helper for site.ts detection utilities.
 *
 * No test framework required. Uses a tiny inline runner.
 *
 * HOW TO RUN (from chrome-extension/):
 *   npx tsx src/detectors/__tests__/site.devtest.ts
 *
 * Or add to package.json scripts:
 *   "test:site": "npx tsx src/detectors/__tests__/site.devtest.ts"
 *
 * This file is type-checked by tsc but NOT bundled by webpack
 * (it is not an entry point and is not imported by any entry point).
 */

import { detectSite, isProbablyJobPage } from "../site"

// ── Minimal inline test runner ────────────────────────────────────────────────

let passed = 0
let failed = 0

function expect<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) {
    console.log(`  ✓  ${label}`)
    passed++
  } else {
    console.error(`  ✗  ${label}`)
    console.error(`       expected: ${String(expected)}`)
    console.error(`       received: ${String(actual)}`)
    failed++
  }
}

// ── detectSite ────────────────────────────────────────────────────────────────

console.log("\ndetectSite()")

expect("linkedin www",          detectSite("https://www.linkedin.com/jobs/view/1234"), "linkedin")
expect("linkedin no-www",       detectSite("https://linkedin.com/jobs/search"),        "linkedin")
expect("greenhouse boards",     detectSite("https://boards.greenhouse.io/acme/jobs/9"), "greenhouse")
expect("greenhouse job-boards", detectSite("https://job-boards.greenhouse.io/acme/jobs/9"), "greenhouse")
expect("greenhouse embed param",detectSite("https://example.com/careers?gh_jid=12345"), "greenhouse")
expect("lever",                 detectSite("https://jobs.lever.co/stripe/abc-def-123"),  "lever")
expect("ashby",                 detectSite("https://jobs.ashbyhq.com/Vercel/open-roles"), "ashby")
expect("workday myworkday",     detectSite("https://amazon.myworkdayjobs.com/en-US/Amazon_Jobs"), "workday")
expect("workday workdayjobs",   detectSite("https://uber.workdayjobs.com/Uber/job/NY/Eng/123"), "workday")
expect("indeed",                detectSite("https://www.indeed.com/viewjob?jk=abc123"),  "indeed")
expect("glassdoor",             detectSite("https://www.glassdoor.com/job-listing/..."), "glassdoor")
expect("unknown random site",   detectSite("https://example.com/about"),                "unknown")
expect("empty string",          detectSite(""),                                          "unknown")

// ── isProbablyJobPage ─────────────────────────────────────────────────────────

console.log("\nisProbablyJobPage() — positive (should return true)")

expect("linkedin /jobs/view/",
  isProbablyJobPage("https://www.linkedin.com/jobs/view/3827482736/"), true)

expect("linkedin /jobs/search/?currentJobId= (sidebar view)",
  isProbablyJobPage("https://www.linkedin.com/jobs/search/?currentJobId=3827482736&keywords=engineer"), true)

expect("linkedin /jobs/collections/?currentJobId=",
  isProbablyJobPage("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3827482736"), true)

expect("greenhouse boards /jobs/12345",
  isProbablyJobPage("https://boards.greenhouse.io/acme/jobs/4567890"), true)

expect("greenhouse job-boards /jobs/12345",
  isProbablyJobPage("https://job-boards.greenhouse.io/acme/jobs/4567890"), true)

expect("greenhouse embed ?gh_jid= on company domain",
  isProbablyJobPage("https://careers.acme.com/open-roles?gh_jid=99999"), true)

expect("lever UUID in path",
  isProbablyJobPage("https://jobs.lever.co/stripe/a1b2c3d4-e5f6-7890-abcd-ef1234567890"), true)

expect("ashby two-segment path",
  isProbablyJobPage("https://jobs.ashbyhq.com/Vercel/senior-engineer"), true)

expect("workday /job/ in path",
  isProbablyJobPage("https://amazon.myworkdayjobs.com/en-US/Amazon_Jobs/job/Seattle/SWE/R-12345"), true)

expect("indeed /viewjob",
  isProbablyJobPage("https://www.indeed.com/viewjob?jk=abc123def456"), true)

expect("glassdoor /job-listing/",
  isProbablyJobPage("https://www.glassdoor.com/job-listing/Staff-Eng-ACME-JV_IC1147401_KO0,12_KE13,17.htm"), true)

expect("glassdoor partner ?jl=",
  isProbablyJobPage("https://www.glassdoor.com/partner/jobListing.htm?pos=1&jl=8765432"), true)

expect("unknown site with ?job_id=",
  isProbablyJobPage("https://careers.example.com/openings?job_id=42"), true)

expect("unknown site with ?jobId=",
  isProbablyJobPage("https://hr.example.org/apply?jobId=7890&source=linkedin"), true)

console.log("\nisProbablyJobPage() — negative (should return false)")

expect("linkedin /jobs/search",
  isProbablyJobPage("https://www.linkedin.com/jobs/search/?keywords=engineer"), false)

expect("linkedin /jobs/collections",
  isProbablyJobPage("https://www.linkedin.com/jobs/collections/recommended/"), false)

expect("greenhouse company board root (no job id)",
  isProbablyJobPage("https://boards.greenhouse.io/acme"), false)

expect("lever company root (no UUID)",
  isProbablyJobPage("https://jobs.lever.co/stripe"), false)

expect("ashby company root (single segment)",
  isProbablyJobPage("https://jobs.ashbyhq.com/Vercel"), false)

expect("workday search results (no /job/ in path)",
  isProbablyJobPage("https://amazon.myworkdayjobs.com/en-US/Amazon_Jobs"), false)

expect("indeed /jobs search",
  isProbablyJobPage("https://www.indeed.com/jobs?q=software+engineer&l=Remote"), false)

expect("glassdoor search results",
  isProbablyJobPage("https://www.glassdoor.com/Job/jobs.htm?sc.keyword=engineer"), false)

expect("random homepage",
  isProbablyJobPage("https://www.google.com"), false)

expect("unknown site with no job params",
  isProbablyJobPage("https://careers.example.com/"), false)

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(44)}`)
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`)
console.log(`${"─".repeat(44)}\n`)

if (failed > 0) process.exit(1)
