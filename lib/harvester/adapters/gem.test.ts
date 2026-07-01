import { strict as assert } from "node:assert"
import { test } from "node:test"
import { gemAdapter } from "./gem"

test("gem: detectFromUrl parses the slug from a path-based board URL", () => {
  assert.deepEqual(gemAdapter.detectFromUrl("https://jobs.gem.com/11x-ai"), {
    slug: "11x-ai",
  })
})

test("gem: detectFromUrl takes the first path segment as the slug", () => {
  assert.deepEqual(
    gemAdapter.detectFromUrl("https://jobs.gem.com/8020-consulting/some-ext-id"),
    { slug: "8020-consulting" }
  )
})

test("gem: detectFromUrl returns null for the bare host with no slug", () => {
  assert.equal(gemAdapter.detectFromUrl("https://jobs.gem.com/"), null)
})

test("gem: detectFromUrl returns null for the api path", () => {
  assert.equal(
    gemAdapter.detectFromUrl("https://jobs.gem.com/api/public/graphql/batch"),
    null
  )
})

test("gem: detectFromUrl returns null for non-Gem hosts", () => {
  assert.equal(gemAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
  assert.equal(gemAdapter.detectFromUrl("https://gem.com/careers"), null)
})

test("gem: fetchJobs maps a mocked GraphQL batch response", async () => {
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    // Assert we POST the batch envelope with a JobBoardList op.
    assert.equal(init?.method, "POST")
    const body = JSON.parse(String(init?.body))
    assert.ok(Array.isArray(body))
    assert.equal(body[0].operationName, "JobBoardList")
    assert.equal(body[0].variables.boardId, "acme")

    return new Response(
      JSON.stringify([
        {
          data: {
            oatsExternalJobPostings: {
              jobPostings: [
                {
                  id: "posting-1",
                  extId: "ext-abc",
                  title: "  Staff Software Engineer  ",
                  locations: [
                    {
                      id: "loc-1",
                      name: "San Francisco, CA",
                      city: "San Francisco",
                      isoCountry: "US",
                      isRemote: false,
                    },
                  ],
                  job: {
                    id: "job-1",
                    locationType: "ONSITE",
                    employmentType: "FULL_TIME",
                    department: { id: "d1", name: "Engineering", extId: "e1" },
                  },
                },
                {
                  id: "posting-2",
                  extId: "ext-def",
                  title: "Remote Support Contractor",
                  locations: [
                    { id: "loc-2", name: "Remote", isRemote: true },
                  ],
                  job: { id: "job-2", employmentType: "CONTRACTOR", department: null },
                },
                // Skipped: missing title.
                { id: "posting-3", extId: "ext-ghi", locations: [], job: {} },
              ],
            },
          },
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  }) as unknown as typeof fetch

  const result = await gemAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "gem")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.notModified, false)
  assert.equal(result.jobs.length, 2)

  const [first, second] = result.jobs

  assert.equal(first.externalId, "gem:ext-abc")
  assert.equal(first.title, "Staff Software Engineer")
  assert.equal(first.applyUrl, "https://jobs.gem.com/acme/ext-abc")
  assert.equal(first.location, "San Francisco, US")
  assert.equal(first.workMode, undefined)
  assert.equal(first.employmentType, "FULL_TIME")
  assert.match(first.contentHash, /^[0-9a-f]{32}$/)

  assert.equal(second.externalId, "gem:ext-def")
  assert.equal(second.title, "Remote Support Contractor")
  assert.equal(second.applyUrl, "https://jobs.gem.com/acme/ext-def")
  assert.equal(second.location, "Remote")
  assert.equal(second.workMode, "remote")
  assert.equal(second.employmentType, "CONTRACT")
})

test("gem: fetchJobs throws with status 404 when the board has GraphQL errors", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify([{ errors: [{ message: "board not found" }] }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  await assert.rejects(
    gemAdapter.fetchJobs({
      slug: "nope",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    (err: Error & { status?: number | null }) => {
      assert.match(err.message, /gem board not found/)
      assert.equal(err.status, 404)
      return true
    }
  )
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_GEM_SLUG ?? "11x-ai"

test("gem: live fetch returns a shaped response", { skip: !LIVE }, async () => {
  const result = await gemAdapter.fetchJobs({
    slug: LIVE_SLUG,
    ctx: { etag: null, lastModified: null },
  })
  assert.equal(result.sourceAts, "gem")
  assert.ok(Array.isArray(result.jobs))
  if (result.jobs.length > 0) {
    const sample = result.jobs[0]
    assert.match(sample.externalId, /^gem:.+/)
    assert.match(sample.applyUrl, /^https:\/\/jobs\.gem\.com\//)
    assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
  }
})
