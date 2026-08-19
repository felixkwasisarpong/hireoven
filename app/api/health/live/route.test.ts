import assert from "node:assert/strict"
import test from "node:test"
import { GET, HEAD, dynamic } from "./route"

test("liveness returns 200 without touching the database", async () => {
  // No pg pool is configured in this test process. If the route ever reaches for
  // one, this throws instead of returning — which is exactly the regression to
  // catch, since a DB-coupled probe turns a slow database into an outage.
  const res = await GET()
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, "ok")
})

test("liveness supports HEAD, which is what most probes send", async () => {
  const res = await HEAD()
  assert.equal(res.status, 200)
})

test("liveness is never cached", async () => {
  // A build-time cached 200 would report healthy for a wedged process.
  assert.equal(dynamic, "force-dynamic")
  const res = await GET()
  assert.match(res.headers.get("cache-control") ?? "", /no-store/)
})
