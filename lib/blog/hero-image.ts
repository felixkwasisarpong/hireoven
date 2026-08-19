/**
 * Attaching a hero image to a blog post.
 *
 * Object storage (MinIO) runs only on the web box, on a private Docker network,
 * with port 9000 unpublished — reachable from the web app container and nothing
 * else. Scheduled jobs run somewhere else entirely: middleware refuses
 * `/api/cron/*` on the web runtime, so blog generation runs on the app-worker on
 * a different machine, where MINIO_ENDPOINT falls back to 127.0.0.1:9000. Every
 * upload there died with ECONNREFUSED while the run still recorded `success`, so
 * posts shipped imageless for weeks and the images that did exist were static
 * files generated and committed by hand.
 *
 * The worker therefore no longer assumes it can reach storage. With
 * BLOG_IMAGE_DELEGATE_URL set it asks the web app — the one process that can
 * reach MinIO — to run the generate-and-store step over an authenticated call.
 * Left unset it stores directly, which is what local dev and the web app itself
 * do, so this is the same code path in both directions.
 */
import { generateAndStoreBlogImage } from "@/lib/blog/image-generator"
import { getPostById, updateBlogPostImage } from "@/lib/blog/queries"

/** Generating an image and pushing it to storage regularly takes ~30-60s. */
const DELEGATE_TIMEOUT_MS = 180_000

export type HeroImageStatus =
  /** Generated and stored on this call. */
  | "created"
  /** The post already had an image; nothing to do. */
  | "already_present"
  /** Image generation or storage is not configured in this environment. */
  | "not_configured"

export type HeroImageOutcome = {
  status: HeroImageStatus
  url: string | null
}

/** Base URL of the app that owns object storage, or null to store locally. */
export function heroImageDelegateUrl(): string | null {
  const raw = process.env.BLOG_IMAGE_DELEGATE_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, "")
}

/**
 * Generate and store the hero image for a post, in this process.
 *
 * Reads the post back rather than taking the generated fields as arguments, so
 * the same call works for a post created seconds ago and for one written weeks
 * ago whose image never landed.
 */
export async function ensureHeroImageForPost(postId: string): Promise<HeroImageOutcome> {
  const post = await getPostById(postId)
  if (!post) throw new Error(`Blog post ${postId} not found`)
  if (post.hero_image_url) {
    return { status: "already_present", url: post.hero_image_url }
  }
  if (!post.category) throw new Error(`Blog post ${postId} has no category`)

  const image = await generateAndStoreBlogImage({
    postId: post.id,
    category: post.category,
    title: post.title,
    excerpt: post.excerpt,
    imagePrompt: post.image_prompt,
    alt: post.hero_image_alt,
  })

  if (!image) return { status: "not_configured", url: null }

  await updateBlogPostImage({
    id: post.id,
    hero_image_url: image.url,
    hero_image_key: image.key,
    hero_image_alt: image.alt,
    image_prompt: image.prompt,
  })

  return { status: "created", url: image.url }
}

/** Ask the app that owns object storage to do the work. */
export async function delegateHeroImage(postId: string, baseUrl: string): Promise<HeroImageOutcome> {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error("CRON_SECRET is required to delegate blog hero image generation")

  const response = await fetch(`${baseUrl}/api/internal/blog/hero-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ postId }),
    signal: AbortSignal.timeout(DELEGATE_TIMEOUT_MS),
  })

  const payload = (await response.json().catch(() => null)) as
    | { status?: HeroImageStatus; url?: string | null; error?: string }
    | null

  if (!response.ok) {
    throw new Error(payload?.error ?? `Hero image delegate returned ${response.status}`)
  }
  if (!payload?.status) {
    throw new Error("Hero image delegate returned no status")
  }

  return { status: payload.status, url: payload.url ?? null }
}

/** Attach a hero image, delegating or storing directly as the environment dictates. */
export async function attachHeroImage(postId: string): Promise<HeroImageOutcome> {
  const delegate = heroImageDelegateUrl()
  return delegate ? delegateHeroImage(postId, delegate) : ensureHeroImageForPost(postId)
}
