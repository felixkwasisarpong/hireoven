import { strict as assert } from "node:assert"
import { test } from "node:test"
import { infosysAdapter, parseInfosysJobs } from "./infosys"

const SAMPLE_JOB_HTML = `
<a href="https://digitalcareers.infosys.com/global-careers/company-job/description/reqid/147882BR" class="job editable-cursor" contenteditable="false" data-query-string="location=USA">
  <div class="left-section">
    <div class="job-title " data-title="Supply Chain Consultant">Supply Chain Consultant</div>
    <div class="job-location js-job-city ">
      <div class="location-inline">Richardson, TX</div>
      <div class="location-inline ">&nbsp;-</div>
      <div class="location-inline">USA </div>
    </div>
    <div class="job-description js-job-reqid ">
      <div class="location-inline">147882BR</div>
    </div>
    <div class="job-description js-job-description hide">
      <div class="location-inline">In the assigned Job Role of Package Consultant 2,  your Area Of Responsibility will be as below: ⚡...</div>
    </div>
  </div>
</a>
<a href="https://digitalcareers.infosys.com/global-careers/company-job/description/reqid/147856BR" class="job">
  <div class="job-title" data-title="Java Lead">Java Lead</div>
  <div class="job-location">
    <div class="location-inline">Plano, TX</div>
    <div class="location-inline">USA</div>
  </div>
  <div class="job-description js-job-reqid">
    <div class="location-inline">147856BR</div>
  </div>
  <div class="job-description js-job-description hide">
    <div class="location-inline">Lead Java engineer for...</div>
  </div>
</a>
`

test("parseInfosysJobs: extracts title, location, externalId, applyUrl", () => {
  const jobs = parseInfosysJobs(SAMPLE_JOB_HTML)
  assert.equal(jobs.length, 2)
  const first = jobs[0]
  assert.equal(first.title, "Supply Chain Consultant")
  assert.equal(first.externalId, "147882BR")
  assert.equal(
    first.applyUrl,
    "https://digitalcareers.infosys.com/global-careers/company-job/description/reqid/147882BR"
  )
  assert.match(first.location ?? "", /Richardson, TX/)
  assert.match(first.location ?? "", /USA/)
  assert.match(first.description ?? "", /Package Consultant/)
  assert.ok(first.contentHash && first.contentHash.length > 0)

  const second = jobs[1]
  assert.equal(second.title, "Java Lead")
  assert.equal(second.externalId, "147856BR")
})

test("parseInfosysJobs: returns empty for HTML with no matching anchors", () => {
  assert.deepEqual(parseInfosysJobs("<html><body>nothing here</body></html>"), [])
})

test("infosysAdapter.detectFromUrl: matches Infosys hostname only", () => {
  assert.deepEqual(
    infosysAdapter.detectFromUrl("https://digitalcareers.infosys.com/infosys/global-careers"),
    { slug: "infosys" }
  )
  assert.deepEqual(
    infosysAdapter.detectFromUrl("https://www.infosys.com/careers"),
    null
  )
  assert.deepEqual(infosysAdapter.detectFromUrl("https://digitalcareers.tcs.com/"), null)
})

test("infosysAdapter.fetchJobs: walks pagination until a page returns no new req-ids", async () => {
  let calls = 0
  const fakeFetch: typeof fetch = async (input) => {
    calls += 1
    const url = String(input)
    const page = Number(new URL(url).searchParams.get("page") ?? "1")
    if (page === 1) {
      return new Response(SAMPLE_JOB_HTML, { status: 200, headers: { "content-type": "text/html" } })
    }
    if (page === 2) {
      // Duplicate of page 1 — every req-id is already seen → loop exits.
      return new Response(SAMPLE_JOB_HTML, { status: 200, headers: { "content-type": "text/html" } })
    }
    return new Response("", { status: 404 })
  }
  const result = await infosysAdapter.fetchJobs({
    slug: "infosys",
    ctx: { etag: null, lastModified: null, fetchImpl: fakeFetch },
  })
  assert.equal(result.jobs.length, 2)
  assert.equal(result.sourceAts, "infosys")
  assert.equal(result.notModified, false)
  assert.ok(calls >= 2)
})
