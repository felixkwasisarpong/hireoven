import test from "node:test"
import assert from "node:assert/strict"

process.env.AUTH_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET ?? "test-secret-that-is-at-least-32-characters-long"

import {
  signSessionFlagsJwt,
  verifySessionFlagsJwt,
  signSessionJwt,
  verifySessionJwt,
} from "./jwt"

const USER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"

test("round-trips the flags it was signed with", async () => {
  const token = await signSessionFlagsJwt(USER, { isAdmin: true, suspended: false })
  assert.deepEqual(await verifySessionFlagsJwt(token, USER), {
    isAdmin: true,
    suspended: false,
  })
})

test("rejects a cache cookie minted for a different account", async () => {
  // Otherwise a suspended user could paste in someone else's clean flags.
  const token = await signSessionFlagsJwt(OTHER, { isAdmin: false, suspended: false })
  assert.equal(await verifySessionFlagsJwt(token, USER), null)
})

test("rejects an expired cache cookie", async () => {
  const token = await signSessionFlagsJwt(USER, { isAdmin: false, suspended: false }, -1)
  assert.equal(await verifySessionFlagsJwt(token, USER), null)
})

test("rejects a forged or tampered cookie", async () => {
  const token = await signSessionFlagsJwt(USER, { isAdmin: false, suspended: true })
  const [header, payload] = token.split(".")
  const forgedPayload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), suspended: false })
  ).toString("base64url")
  assert.equal(await verifySessionFlagsJwt(`${header}.${forgedPayload}.sig`, USER), null)
})

test("rejects a session token used as a flags cookie", async () => {
  // Session JWTs carry `sub`/`suspended` too and last 14 days, so accepting one
  // here would let a user pin clean flags far past the one-minute cache window.
  const session = await signSessionJwt({ sub: USER, email: null, isAdmin: false, suspended: false })
  assert.equal(await verifySessionFlagsJwt(session, USER), null)
})

test("rejects a flags token used as a session cookie", async () => {
  const flags = await signSessionFlagsJwt(USER, { isAdmin: true, suspended: false })
  assert.equal(await verifySessionJwt(flags), null)
})

test("still accepts existing session cookies, which carry no type claim", async () => {
  // Requiring a type on session tokens would sign every logged-in user out.
  const legacy = await signSessionJwt({ sub: USER, email: "a@b.com", isAdmin: false, suspended: false })
  assert.equal((await verifySessionJwt(legacy))?.sub, USER)
})
