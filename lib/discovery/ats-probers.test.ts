import { strict as assert } from "node:assert"
import { test } from "node:test"
import { slugVariants, probeCompanyForAts } from "@/lib/discovery/ats-probers"

test("slugVariants: strips legal suffixes + yields compact/hyphen/first-word", () => {
  const v = slugVariants("Acme Widgets, Inc.")
  assert.ok(v.includes("acmewidgets"))
  assert.ok(v.includes("acme-widgets"))
  assert.ok(v.includes("acme"))
})

function html(setCookie: string, body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === "set-cookie" ? setCookie : null) },
    text: async () => body,
    json: async () => ({}),
  } as unknown as Response
}
function json(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

test("probeCompanyForAts: finds an eightfold board via careers + pcsx count", async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes(".eightfold.ai/careers")) return html("_vs=abc; Path=/", '<meta name="_csrf" content="tok">')
    if (u.includes("/api/pcsx/search")) return json({ status: 200, data: { count: 812 } })
    return json({}, false)
  }) as unknown as typeof fetch

  const hit = await probeCompanyForAts("Vodafone", fetchImpl)
  assert.ok(hit)
  assert.equal(hit.atsType, "eightfold")
  assert.equal(hit.identifier, "vodafone")
  assert.equal(hit.jobCount, 812)
  assert.match(hit.directAtsUrl, /vodafone\.eightfold\.ai/)
})

test("probeCompanyForAts: finds a Workable board (path-based, crt.sh-invisible)", async () => {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.includes("apply.workable.com/api/v3/accounts/acme/jobs") && init?.method === "POST") {
      return json({ total: 27, results: [] })
    }
    return json({}, false)
  }) as unknown as typeof fetch

  const hit = await probeCompanyForAts("Acme Inc", fetchImpl)
  assert.ok(hit)
  assert.equal(hit.atsType, "workable")
  assert.equal(hit.identifier, "acme")
  assert.equal(hit.jobCount, 27)
  assert.match(hit.careersUrl, /apply\.workable\.com\/acme/)
})

test("probeCompanyForAts: falls through to greenhouse when eightfold is empty", async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes(".eightfold.ai/careers")) return json({}, false) // no eightfold board
    if (u.includes("boards-api.greenhouse.io") && u.includes("acme/jobs")) {
      return json({ jobs: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    }
    return json({}, false)
  }) as unknown as typeof fetch

  const hit = await probeCompanyForAts("Acme Inc", fetchImpl)
  assert.ok(hit)
  assert.equal(hit.atsType, "greenhouse")
  assert.equal(hit.identifier, "acme")
  assert.equal(hit.jobCount, 3)
})

test("probeCompanyForAts: returns null when no platform has a board", async () => {
  const fetchImpl = (async () => json({}, false)) as unknown as typeof fetch
  const hit = await probeCompanyForAts("Nonexistent Co", fetchImpl)
  assert.equal(hit, null)
})
