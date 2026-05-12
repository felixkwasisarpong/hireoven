import { strict as assert } from "node:assert"
import { test } from "node:test"
import { resolveWorkdaySite } from "./workday-resolver"

test("workday-resolver: extracts site from redirect with locale prefix", async () => {
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const target = typeof url === "string" ? url : url.toString()
    if (target.endsWith("/")) {
      return {
        ok: true,
        status: 200,
        url: "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite",
      } as Response
    }
    return { ok: false, status: 404 } as Response
  }) as unknown as typeof fetch

  const result = await resolveWorkdaySite({
    tenant: "nvidia",
    wd: "wd5",
    fetchImpl: fakeFetch,
  })
  assert.deepEqual(result, { site: "NVIDIAExternalCareerSite", source: "redirect" })
})

test("workday-resolver: extracts site from redirect without locale prefix", async () => {
  const fakeFetch = (async () =>
    ({
      ok: true,
      status: 200,
      url: "https://acme.wd1.myworkdayjobs.com/External",
    }) as Response) as unknown as typeof fetch

  const result = await resolveWorkdaySite({ tenant: "acme", wd: "wd1", fetchImpl: fakeFetch })
  assert.deepEqual(result, { site: "External", source: "redirect" })
})

test("workday-resolver: falls back to sites API when redirect lands on root", async () => {
  const fakeFetch = (async (url: string | URL) => {
    const target = typeof url === "string" ? url : url.toString()
    if (target.endsWith("/")) {
      // Redirected back to root with no site path.
      return { ok: true, status: 200, url: "https://acme.wd1.myworkdayjobs.com/" } as Response
    }
    if (target.includes("/wday/cxs/acme/sites")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sites: [{ name: "Careers" }, { name: "Internal" }] }),
      } as unknown as Response
    }
    return { ok: false, status: 404 } as Response
  }) as unknown as typeof fetch

  const result = await resolveWorkdaySite({ tenant: "acme", wd: "wd1", fetchImpl: fakeFetch })
  assert.deepEqual(result, { site: "Careers", source: "sites-api" })
})

test("workday-resolver: returns null when both strategies fail", async () => {
  const fakeFetch = (async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch
  const result = await resolveWorkdaySite({
    tenant: "nope",
    wd: "wd1",
    fetchImpl: fakeFetch,
  })
  assert.equal(result, null)
})

test("workday-resolver: rejects redirect to a non-Workday host", async () => {
  const fakeFetch = (async (url: string | URL) => {
    const target = typeof url === "string" ? url : url.toString()
    if (target.endsWith("/")) {
      return { ok: true, status: 200, url: "https://www.example.com/jobs" } as Response
    }
    return { ok: false, status: 404 } as Response
  }) as unknown as typeof fetch

  const result = await resolveWorkdaySite({ tenant: "acme", wd: "wd1", fetchImpl: fakeFetch })
  assert.equal(result, null)
})

test("workday-resolver: falls back to POST probe when redirect + sites-API both fail", async () => {
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const target = typeof url === "string" ? url : url.toString()
    if (init?.method === "POST" && target.includes("/NVIDIAExternalCareerSite/jobs")) {
      return { ok: true, status: 200 } as Response
    }
    if (init?.method === "POST" && target.includes("/External/jobs")) {
      return { ok: false, status: 404 } as Response
    }
    if (init?.method === "POST") {
      return { ok: false, status: 404 } as Response
    }
    return { ok: false, status: 406 } as Response
  }) as unknown as typeof fetch

  const result = await resolveWorkdaySite({ tenant: "nvidia", wd: "wd5", fetchImpl: fakeFetch })
  assert.deepEqual(result, { site: "NVIDIAExternalCareerSite", source: "probe" })
})

test("workday-resolver: rejects sites with malformed names", async () => {
  const fakeFetch = (async (url: string | URL) => {
    const target = typeof url === "string" ? url : url.toString()
    if (target.endsWith("/")) return { ok: true, status: 200, url: "https://acme.wd1.myworkdayjobs.com/" } as Response
    if (target.includes("/sites")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sites: [{ name: "site with spaces" }, { name: "Real-Site_1" }] }),
      } as unknown as Response
    }
    return { ok: false, status: 404 } as Response
  }) as unknown as typeof fetch

  const result = await resolveWorkdaySite({ tenant: "acme", wd: "wd1", fetchImpl: fakeFetch })
  assert.deepEqual(result, { site: "Real-Site_1", source: "sites-api" })
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"

test(
  "workday-resolver: live resolution against NVIDIA",
  { skip: !LIVE },
  async () => {
    const result = await resolveWorkdaySite({ tenant: "nvidia", wd: "wd5" })
    assert.ok(result, "expected NVIDIA Workday to resolve")
    assert.match(result!.site, /^[A-Za-z0-9_-]+$/)
  }
)
