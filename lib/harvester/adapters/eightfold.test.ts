import { strict as assert } from "node:assert"
import { test } from "node:test"
import { eightfoldAdapter } from "./eightfold"
import type { HarvestCtx } from "./_base"

function htmlResponse(setCookie: string, html: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === "set-cookie" ? setCookie : null) },
    text: async () => html,
    json: async () => ({}),
  } as unknown as Response
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

test("eightfold: detectFromUrl resolves a {tenant}.eightfold.ai slug", () => {
  assert.deepEqual(eightfoldAdapter.detectFromUrl("https://hsbc.eightfold.ai/careers"), { slug: "hsbc" })
  assert.equal(eightfoldAdapter.detectFromUrl("https://boards.greenhouse.io/x"), null)
})

test("eightfold: falls back to the apply/v2 dialect when pcsx/search 403s", async () => {
  // HSBC/Bayer-style tenant: session establishes, but pcsx/search 403s even with a
  // valid cookie+CSRF — the adapter must fall back to the open apply/v2 dialect.
  const applyV2 = {
    count: 2,
    positions: [
      {
        id: 111,
        name: "Engineer",
        locations: ["NYC, NY, USA"],
        t_update: 1782796640,
        canonicalPositionUrl: "https://portal.careers.hsbc.com/careers/job/111",
        display_job_id: "A1",
        work_location_option: "remote",
        job_description: "<p>Build trading systems in C++.</p>",
      },
      {
        id: 222,
        name: "Analyst",
        location: "London, UK",
        t_update: 1782700000,
        canonicalPositionUrl: "https://portal.careers.hsbc.com/careers/job/222",
      },
    ],
  }
  const seen: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url)
    seen.push(u)
    if (u.includes("/careers") && !u.includes("/api/")) {
      return htmlResponse("_vs=abc123; Path=/", '<meta name="_csrf" content="tok123">')
    }
    if (u.includes("/api/pcsx/search")) return jsonResponse({}, false, 403)
    if (u.includes("/api/apply/v2/jobs")) {
      return u.includes("start=0") ? jsonResponse(applyV2) : jsonResponse({ count: 2, positions: [] })
    }
    return jsonResponse({}, false, 403) // position_details also 403 for these tenants
  }) as unknown as HarvestCtx["fetchImpl"]

  const result = await eightfoldAdapter.fetchJobs({
    slug: "hsbc",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "eightfold")
  assert.ok(
    seen.some((u) => u.includes("/api/pcsx/search")),
    "tried pcsx/search first",
  )
  assert.ok(
    seen.some((u) => u.includes("/api/apply/v2/jobs")),
    "fell back to apply/v2",
  )
  assert.equal(result.jobs.length, 2)
  const j = result.jobs.find((x) => x.externalId === "eightfold:111")!
  assert.ok(j)
  assert.equal(j.title, "Engineer")
  assert.equal(j.location, "NYC, NY, USA")
  assert.equal(j.applyUrl, "https://portal.careers.hsbc.com/careers/job/111")
  assert.equal(j.workMode, "remote")
  assert.equal(j.postedAt, new Date(1782796640 * 1000).toISOString())
  // apply/v2 carries the JD inline — captured directly, no pcsx detail round-trip
  assert.match(j.description ?? "", /Build trading systems in C\+\+/)
  assert.ok(
    !seen.some((u) => u.includes("/api/pcsx/position_details")),
    "apply/v2 dialect must skip the pcsx detail pass",
  )
})
