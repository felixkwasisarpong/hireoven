import assert from "node:assert/strict"
import test from "node:test"
import { NextRequest } from "next/server"
import type { ApplicationXRay } from "../types"
import { APPLICATION_XRAY_SCHEMA_VERSION } from "../types"
import { ApplicationXRayLoadError } from "./load-input"
import type { ApplicationXRayResponsePayload } from "./records"
import { handleApplicationXRayRoute } from "../../../app/api/jobs/[id]/xray/handler"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const JOB_ID = "22222222-2222-4222-8222-222222222222"
const RESUME_ID = "44444444-4444-4444-8444-444444444444"
const NOW = "2026-08-13T12:00:00.000Z"

test("GET /api/jobs/[id]/xray returns 401 when unauthenticated", async () => {
  let called = false
  const response = await handleApplicationXRayRoute(request(), context(), {
    getSessionUser: async () => null,
    getApplicationXRayForUser: async () => {
      called = true
      return payload()
    },
  })

  assert.equal(response.status, 401)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(called, false)
  assert.deepEqual(await response.json(), { error: "Unauthorized" })
})

test("GET /api/jobs/[id]/xray forwards only authenticated user, job id, resume id, and request-time now", async () => {
  let captured: unknown = null
  const response = await handleApplicationXRayRoute(
    request(`http://localhost/api/jobs/${JOB_ID}/xray?resumeId=${RESUME_ID}&userId=evil`),
    context(),
    {
      getSessionUser: async () => ({ sub: USER_ID, email: "user@example.com" }),
      now: () => NOW,
      getApplicationXRayForUser: async (input) => {
        captured = input
        return payload()
      },
    },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(captured, {
    userId: USER_ID,
    jobId: JOB_ID,
    resumeId: RESUME_ID,
    now: NOW,
  })
  assert.deepEqual(await response.json(), payload())
})

test("GET /api/jobs/[id]/xray passes null resume id when omitted or blank", async () => {
  const seen: Array<string | null | undefined> = []
  for (const url of [
    `http://localhost/api/jobs/${JOB_ID}/xray`,
    `http://localhost/api/jobs/${JOB_ID}/xray?resumeId=`,
  ]) {
    const response = await handleApplicationXRayRoute(request(url), context(), {
      getSessionUser: async () => ({ sub: USER_ID, email: null }),
      now: () => NOW,
      getApplicationXRayForUser: async (input) => {
        seen.push(input.resumeId)
        return payload()
      },
    })
    assert.equal(response.status, 200)
  }

  assert.deepEqual(seen, [null, null])
})

test("GET /api/jobs/[id]/xray maps loader errors without sensitive details", async () => {
  for (const [status, code] of [
    [400, "MALFORMED_RESUME_ID"],
    [403, "RESUME_FORBIDDEN"],
    [404, "JOB_NOT_FOUND"],
    [409, "XRAY_CONFLICT"],
  ] as const) {
    const response = await handleApplicationXRayRoute(request(), context(), {
      getSessionUser: async () => ({ sub: USER_ID, email: null }),
      getApplicationXRayForUser: async () => {
        throw new ApplicationXRayLoadError(status, code, "private details")
      },
    })
    assert.equal(response.status, status)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(await response.json(), { error: code })
  }
})

test("GET /api/jobs/[id]/xray hides unexpected server errors", async () => {
  const originalError = console.error
  const logs: unknown[] = []
  console.error = (...args: unknown[]) => {
    logs.push(args)
  }
  try {
    const response = await handleApplicationXRayRoute(request(), context(), {
      getSessionUser: async () => ({ sub: USER_ID, email: null }),
      getApplicationXRayForUser: async () => {
        throw new Error("database password leaked")
      },
    })

    assert.equal(response.status, 500)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(await response.json(), { error: "APPLICATION_XRAY_FAILED" })
    assert.equal(JSON.stringify(logs).includes("database password leaked"), false)
  } finally {
    console.error = originalError
  }
})

function request(url = `http://localhost/api/jobs/${JOB_ID}/xray`) {
  return new NextRequest(url)
}

function context() {
  return { params: Promise.resolve({ id: JOB_ID }) }
}

function payload(): ApplicationXRayResponsePayload {
  return {
    xray: {
      schemaVersion: APPLICATION_XRAY_SCHEMA_VERSION,
      requestedJobId: JOB_ID,
      evaluatedJobId: JOB_ID,
      userId: USER_ID,
      resumeId: RESUME_ID,
      computedAt: NOW,
      finalAction: "APPLY_NOW",
    } as unknown as ApplicationXRay,
    meta: {
      requestedJobId: JOB_ID,
      evaluatedJobId: JOB_ID,
      resumeId: RESUME_ID,
      computedAt: NOW,
      schemaVersion: APPLICATION_XRAY_SCHEMA_VERSION,
    },
  }
}
