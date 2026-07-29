import { strict as assert } from "node:assert"
import { test } from "node:test"
import { amazonAdapter } from "./amazon"

test("amazon: detectFromUrl matches amazon.jobs hosts", () => {
  assert.deepEqual(amazonAdapter.detectFromUrl("https://www.amazon.jobs/en/jobs/123/x"), { slug: "amazon" })
  assert.deepEqual(amazonAdapter.detectFromUrl("https://amazon.jobs/en/search"), { slug: "amazon" })
})

test("amazon: detectFromUrl rejects non-amazon.jobs hosts", () => {
  assert.equal(amazonAdapter.detectFromUrl("https://www.amazon.com/jobs"), null)
  assert.equal(amazonAdapter.detectFromUrl("https://boards.greenhouse.io/amazon"), null)
})

test("amazon: maps a page, assembles JD, and filters by country_code", async () => {
  const page = {
    hits: 2,
    jobs: [
      {
        id: 111,
        title: "Senior Software Engineer",
        job_path: "/en/jobs/111/senior-software-engineer",
        city: "Seattle",
        state: "Washington",
        country_code: "USA",
        posted_date: "June 1, 2026",
        description: "Build planet-scale systems <br/> with great teams.",
        basic_qualifications: "- 5+ years experience",
        preferred_qualifications: "- AWS, TypeScript",
        job_schedule_type: "Full Time",
      },
      {
        id: 222,
        title: "Operations Manager",
        job_path: "/en/jobs/222/ops",
        city: "Sydney",
        country_code: "AUS", // must be filtered out by default USA,CAN
        posted_date: "June 2, 2026",
        description: "Manage the floor.",
      },
    ],
  }

  // First page returns 2 (< PAGE_SIZE) so the adapter stops after it.
  const fetchImpl = (async () =>
    new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  const result = await amazonAdapter.fetchJobs({
    slug: "amazon",
    ctx: { etag: null, lastModified: null, timeoutMs: 5_000, fetchImpl },
  })

  assert.equal(result.sourceAts, "amazon")
  assert.equal(result.jobs.length, 1) // AUS row filtered out

  const job = result.jobs[0]
  assert.equal(job.externalId, "111")
  assert.equal(job.title, "Senior Software Engineer")
  assert.equal(job.applyUrl, "https://www.amazon.jobs/en/jobs/111/senior-software-engineer")
  assert.equal(job.location, "Seattle, Washington")
  assert.equal(job.employmentType, "fulltime")
  assert.equal(job.postedAt, new Date("June 1, 2026").toISOString())
  assert.match(job.contentHash, /^[0-9a-f]{32}$/)
  assert.ok(job.description?.includes("Basic qualifications:"))
  assert.ok(job.description?.includes("Preferred qualifications:"))
  assert.ok(!job.description?.includes("<br/>")) // HTML stripped
})

test("amazon: stops pagination at the internal soft deadline instead of running until hard-killed", async () => {
  // Real bug: a full ~100-page traversal took ~290s at Amazon's current job
  // volume but the outer per-company timeout was 150s, so every run got
  // hard-killed with ZERO results (the in-flight `jobs` array is discarded,
  // not returned, when the outer AbortSignal fires). The adapter must give
  // up gracefully on its own before that happens and return whatever it has.
  const originalDeadline = process.env.HARVESTER_AMAZON_SOFT_DEADLINE_MS
  process.env.HARVESTER_AMAZON_SOFT_DEADLINE_MS = "100"

  let calls = 0
  const fullPage = {
    hits: 100,
    jobs: Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      title: `Job ${i + 1}`,
      job_path: `/en/jobs/${i + 1}/job`,
      city: "Seattle",
      state: "Washington",
      country_code: "USA",
      posted_date: "June 1, 2026",
      description: "Some role.",
    })),
  }
  const fetchImpl = (async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 15))
    return new Response(JSON.stringify(fullPage), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch

  try {
    const result = await amazonAdapter.fetchJobs({
      slug: "amazon",
      ctx: { etag: null, lastModified: null, timeoutMs: 5_000, fetchImpl },
    })
    // Full pagination would be 100 pages; the soft deadline must cut this
    // off far short of that, and it must still return real, non-empty jobs.
    assert.ok(calls < 100, `expected pagination to stop early, made ${calls} calls`)
    assert.ok(result.jobs.length > 0, "must return whatever was collected, not zero")
  } finally {
    if (originalDeadline === undefined) delete process.env.HARVESTER_AMAZON_SOFT_DEADLINE_MS
    else process.env.HARVESTER_AMAZON_SOFT_DEADLINE_MS = originalDeadline
  }
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
test("amazon: live fetch returns shaped US/CA jobs", { skip: !LIVE }, async () => {
  process.env.HARVESTER_AMAZON_MAX_PAGES = "2"
  const result = await amazonAdapter.fetchJobs({ slug: "amazon", ctx: { etag: null, lastModified: null } })
  assert.equal(result.sourceAts, "amazon")
  assert.ok(result.jobs.length > 0)
  assert.match(result.jobs[0].applyUrl, /^https:\/\/www\.amazon\.jobs\//)
})
