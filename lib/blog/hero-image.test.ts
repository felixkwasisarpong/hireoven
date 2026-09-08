import { strict as assert } from "node:assert"
import { afterEach, test } from "node:test"
import { delegateHeroImage, heroImageDelegateUrl } from "./hero-image"

const realFetch = globalThis.fetch
const realDelegate = process.env.BLOG_IMAGE_DELEGATE_URL
const realSecret = process.env.CRON_SECRET
const realAutoDelegate = process.env.BLOG_IMAGE_AUTO_DELEGATE
const realMinioEndpoint = process.env.MINIO_ENDPOINT
const realAppUrl = process.env.NEXT_PUBLIC_APP_URL
const realSiteUrl = process.env.NEXT_PUBLIC_SITE_URL

afterEach(() => {
  globalThis.fetch = realFetch
  if (realDelegate === undefined) delete process.env.BLOG_IMAGE_DELEGATE_URL
  else process.env.BLOG_IMAGE_DELEGATE_URL = realDelegate
  if (realSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = realSecret
  if (realAutoDelegate === undefined) delete process.env.BLOG_IMAGE_AUTO_DELEGATE
  else process.env.BLOG_IMAGE_AUTO_DELEGATE = realAutoDelegate
  if (realMinioEndpoint === undefined) delete process.env.MINIO_ENDPOINT
  else process.env.MINIO_ENDPOINT = realMinioEndpoint
  if (realAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = realAppUrl
  if (realSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = realSiteUrl
})

function stubFetch(response: { ok: boolean; status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    }
  }) as unknown as typeof fetch
  return calls
}

test("no delegate configured means store locally", () => {
  delete process.env.BLOG_IMAGE_DELEGATE_URL
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.MINIO_ENDPOINT
  assert.equal(heroImageDelegateUrl(), null)

  process.env.BLOG_IMAGE_DELEGATE_URL = "   "
  assert.equal(heroImageDelegateUrl(), null)
})

test("delegate URL drops trailing slashes so the path is not doubled", () => {
  process.env.BLOG_IMAGE_DELEGATE_URL = "https://hireoven.com//"
  assert.equal(heroImageDelegateUrl(), "https://hireoven.com")
})

test("loopback MinIO endpoint auto-delegates to the public app origin", () => {
  delete process.env.BLOG_IMAGE_DELEGATE_URL
  process.env.MINIO_ENDPOINT = "http://127.0.0.1:9000"
  process.env.NEXT_PUBLIC_APP_URL = "https://hireoven.com/"

  assert.equal(heroImageDelegateUrl(), "https://hireoven.com")
})

test("auto delegation does not target local app origins", () => {
  delete process.env.BLOG_IMAGE_DELEGATE_URL
  process.env.MINIO_ENDPOINT = "http://127.0.0.1:9000"
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"

  assert.equal(heroImageDelegateUrl(), null)
})

test("non-loopback MinIO endpoint stores directly", () => {
  delete process.env.BLOG_IMAGE_DELEGATE_URL
  process.env.MINIO_ENDPOINT = "http://hireoven-minio:9000"
  process.env.NEXT_PUBLIC_APP_URL = "https://hireoven.com"

  assert.equal(heroImageDelegateUrl(), null)
})

test("auto delegation can be disabled explicitly", () => {
  delete process.env.BLOG_IMAGE_DELEGATE_URL
  process.env.BLOG_IMAGE_AUTO_DELEGATE = "false"
  process.env.MINIO_ENDPOINT = "http://127.0.0.1:9000"
  process.env.NEXT_PUBLIC_APP_URL = "https://hireoven.com"

  assert.equal(heroImageDelegateUrl(), null)
})

test("delegating posts the id to the web app with the cron secret", async () => {
  process.env.CRON_SECRET = "s3cret"
  const calls = stubFetch({ ok: true, status: 200, body: { ok: true, status: "created", url: "/api/blog/images/blog/p1/hero.webp" } })

  const outcome = await delegateHeroImage("p1", "https://hireoven.com")

  assert.equal(outcome.status, "created")
  assert.equal(outcome.url, "/api/blog/images/blog/p1/hero.webp")
  assert.equal(calls[0]?.url, "https://hireoven.com/api/internal/blog/hero-image")
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer s3cret")
  assert.equal(calls[0]?.init.body, JSON.stringify({ postId: "p1" }))
})

test("a failing delegate surfaces the remote error rather than reporting success", async () => {
  process.env.CRON_SECRET = "s3cret"
  stubFetch({ ok: false, status: 500, body: { error: "connect ECONNREFUSED 127.0.0.1:9000" } })

  await assert.rejects(
    () => delegateHeroImage("p1", "https://hireoven.com"),
    /ECONNREFUSED/,
  )
})

test("a delegate answering without a status is treated as a failure", async () => {
  process.env.CRON_SECRET = "s3cret"
  stubFetch({ ok: true, status: 200, body: { ok: true } })

  await assert.rejects(() => delegateHeroImage("p1", "https://hireoven.com"), /no status/i)
})

test("delegating without a shared secret fails loudly", async () => {
  delete process.env.CRON_SECRET
  await assert.rejects(() => delegateHeroImage("p1", "https://hireoven.com"), /CRON_SECRET/)
})
