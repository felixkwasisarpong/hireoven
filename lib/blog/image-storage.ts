import * as Minio from "minio"

let client: Minio.Client | null = null
let bucketReady = false

const BLOG_IMAGE_PREFIX = "blog/"

export type BlogImageObject = {
  stream: NodeJS.ReadableStream
  size: number | null
  etag: string | null
  lastModified: Date | null
  contentType: string | null
}

function accessKey(): string {
  return process.env.MINIO_ACCESS_KEY?.trim() || process.env.MINIO_ROOT_USER?.trim() || ""
}

function secretKey(): string {
  return process.env.MINIO_SECRET_KEY?.trim() || process.env.MINIO_ROOT_PASSWORD?.trim() || ""
}

function bucketName(): string {
  const bucket = process.env.MINIO_BUCKET?.trim()
  if (!bucket) throw new Error("MINIO_BUCKET is required for blog image storage")
  return bucket
}

function parseEndpoint(): { endPoint: string; port: number; useSSL: boolean } {
  const raw = process.env.MINIO_ENDPOINT?.trim() || "http://127.0.0.1:9000"
  const withProto = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`
  const url = new URL(withProto)
  const useSSL = url.protocol === "https:"
  const port = url.port ? Number(url.port) : useSSL ? 443 : 9000
  return { endPoint: url.hostname, port, useSSL }
}

function getClient(): Minio.Client {
  if (client) return client

  const { endPoint, port, useSSL } = parseEndpoint()
  client = new Minio.Client({
    endPoint,
    port,
    useSSL,
    accessKey: accessKey(),
    secretKey: secretKey(),
    pathStyle: process.env.MINIO_PATH_STYLE !== "false",
  })

  return client
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  const mc = getClient()
  const bucket = bucketName()
  const exists = await mc.bucketExists(bucket)
  if (!exists) {
    await mc.makeBucket(bucket, "us-east-1")
  }
  bucketReady = true
}

export function isBlogImageStorageConfigured(): boolean {
  return Boolean(process.env.MINIO_BUCKET?.trim() && accessKey() && secretKey())
}

export async function ensureBlogImageStorageReady(): Promise<void> {
  await ensureBucket()
}

export function blogImageUrlForKey(key: string): string {
  const safeKey = normalizeBlogImageKey(key)
  return `/api/blog/images/${safeKey.split("/").map(encodeURIComponent).join("/")}`
}

export function normalizeBlogImageKey(key: string): string {
  const normalized = key.replace(/^\/+/, "")
  if (
    !normalized.startsWith(BLOG_IMAGE_PREFIX) ||
    normalized.includes("..") ||
    normalized.includes("\\") ||
    normalized.split("/").some((segment) => segment.length === 0)
  ) {
    throw new Error("Invalid blog image key")
  }
  return normalized
}

export async function uploadBlogImageBuffer(input: {
  key: string
  buffer: Buffer
  contentType: string
}): Promise<{ key: string; url: string }> {
  await ensureBucket()
  const key = normalizeBlogImageKey(input.key)
  const contentType = input.contentType || "application/octet-stream"

  await getClient().putObject(bucketName(), key, input.buffer, input.buffer.length, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  })

  return { key, url: blogImageUrlForKey(key) }
}

export async function getBlogImageObject(key: string): Promise<BlogImageObject> {
  await ensureBucket()
  const safeKey = normalizeBlogImageKey(key)
  const mc = getClient()
  const [stream, stat] = await Promise.all([
    mc.getObject(bucketName(), safeKey),
    mc.statObject(bucketName(), safeKey),
  ])

  const metadata = stat.metaData ?? {}
  const contentType =
    String(metadata["content-type"] ?? metadata["Content-Type"] ?? "").trim() || null

  return {
    stream,
    size: Number.isFinite(stat.size) ? stat.size : null,
    etag: stat.etag || null,
    lastModified: stat.lastModified ?? null,
    contentType,
  }
}
