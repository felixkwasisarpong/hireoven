import test from "node:test"
import assert from "node:assert/strict"
import { detectAts, detectAtsFromUrl } from "@/lib/companies/detect-ats"

test("detectAtsFromUrl recognizes greenhouse boards", () => {
  const result = detectAtsFromUrl("https://boards.greenhouse.io/example/jobs/123")
  assert.equal(result?.atsType, "greenhouse")
  assert.equal(result?.atsIdentifier, "example")
})

test("detectAtsFromUrl recognizes lever, ashby, smartrecruiters, workday, icims, bamboohr", () => {
  assert.equal(detectAtsFromUrl("https://jobs.lever.co/acme/abc")?.atsType, "lever")
  assert.equal(detectAtsFromUrl("https://jobs.ashbyhq.com/acme/role")?.atsType, "ashby")
  assert.equal(detectAtsFromUrl("https://jobs.smartrecruiters.com/acme")?.atsType, "smartrecruiters")
  assert.equal(detectAtsFromUrl("https://acme.wd5.myworkdayjobs.com/en-US/Careers")?.atsType, "workday")
  assert.equal(detectAtsFromUrl("https://acme.icims.com/jobs/search")?.atsType, "icims")
  assert.equal(detectAtsFromUrl("https://acme.bamboohr.com/careers")?.atsType, "bamboohr")
})

test("detectAts prefers apply URL evidence over careers URL", () => {
  const detection = detectAts({
    careersUrl: "https://acme.com/careers",
    applyUrls: [
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://boards.greenhouse.io/acme/jobs/2",
    ],
  })
  assert.equal(detection?.atsType, "greenhouse")
  assert.equal(detection?.confidence, "high")
  assert.equal(detection?.source, "url")
})

test("detectAts falls back to HTML signature for branded iCIMS portals", () => {
  const html = `
    <html><body>
      <div>Welcome to careers at Acme</div>
      <script src="https://careers-acme.icims.com/jobs/scripts/ats.js"></script>
      <a href="https://careers-acme.icims.com/jobs/123">Software Engineer</a>
    </body></html>
  `
  const detection = detectAts({
    careersUrl: "https://careers.acme.com/jobs",
    applyUrls: [],
    html,
  })
  assert.equal(detection?.atsType, "icims")
  assert.equal(detection?.source, "html")
})

test("detectAts returns null when nothing matches", () => {
  const detection = detectAts({
    careersUrl: "https://acme.com/about",
    applyUrls: [],
    html: "<html><body><h1>About us</h1></body></html>",
  })
  assert.equal(detection, null)
})
