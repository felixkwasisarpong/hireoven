import * as Minio from "minio"

/**
 * Local or self-hosted MinIO via the official MinIO JavaScript SDK (`minio` on npm).
 * (Python stacks use boto3; this Next.js app uses the MinIO client, same S3 API.)
 *
 * Required: MINIO_BUCKET, MINIO_ACCESS_KEY (or MINIO_ROOT_USER), MINIO_SECRET_KEY (or MINIO_ROOT_PASSWORD)
 * Endpoint: MINIO_ENDPOINT — full URL, e.g. http://127.0.0.1:9000 (default if unset)
 */

let client: Minio.Client | null = null
let bucketReady = false

function accessKey(): string {
  return (
    process.env.MINIO_ACCESS_KEY?.trim() ||
    process.env.MINIO_ROOT_USER?.trim() ||
    ""
  )
}

function secretKey(): string {
  return (
    process.env.MINIO_SECRET_KEY?.trim() ||
    process.env.MINIO_ROOT_PASSWORD?.trim() ||
    ""
  )
}

function hasMinioCredentials(): boolean {
  return Boolean(
    process.env.MINIO_BUCKET?.trim() && accessKey() && secretKey()
  )
}

/** True when MinIO (S3-compatible) credentials and bucket are configured. */
export function isResumeMinioConfigured(): boolean {
  return hasMinioCredentials()
}

function bucketName(): string {
  const b = process.env.MINIO_BUCKET?.trim()
  if (!b) throw new Error("MINIO_BUCKET is required for MinIO resume storage")
  return b
}

function parseEndpoint(): { endPoint: string; port: number; useSSL: boolean } {
  const raw = process.env.MINIO_ENDPOINT?.trim() || "http://127.0.0.1:9000"
  const withProto = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`
  const url = new URL(withProto)
  const useSSL = url.protocol === "https:"
  const port = url.port
    ? Number(url.port)
    : useSSL
      ? 443
      : 9000
  return { endPoint: url.hostname, port, useSSL }
}

function getMinioClient(): Minio.Client {
  if (client) return client

  const { endPoint, port, useSSL } = parseEndpoint()
  const pathStyle = process.env.MINIO_PATH_STYLE !== "false"

  client = new Minio.Client({
    endPoint,
    port,
    useSSL,
    accessKey: accessKey(),
    secretKey: secretKey(),
    pathStyle,
  })

  return client
}

async function ensureResumeBucket(): Promise<void> {
  if (bucketReady) return
  const mc = getMinioClient()
  const bucket = bucketName()
  const exists = await mc.bucketExists(bucket)
  if (!exists) {
    await mc.makeBucket(bucket, "us-east-1")
  }
  bucketReady = true
}

const DEFAULT_PRESIGN_SECONDS = 60 * 60

export async function presignResumeGetMinio(
  key: string,
  expiresInSeconds = DEFAULT_PRESIGN_SECONDS
): Promise<string> {
  await ensureResumeBucket()
  return getMinioClient().presignedGetObject(bucketName(), key, expiresInSeconds)
}

export async function uploadResumeMinio(
  key: string,
  file: File
): Promise<{ url: string; path: string }> {
  await ensureResumeBucket()
  const buffer = Buffer.from(await file.arrayBuffer())
  const metaData: Record<string, string> = {}
  if (file.type) {
    metaData["Content-Type"] = file.type
  } else {
    metaData["Content-Type"] = "application/octet-stream"
  }

  await getMinioClient().putObject(bucketName(), key, buffer, buffer.length, metaData)
  const url = await presignResumeGetMinio(key)
  return { url, path: key }
}

export async function deleteResumeMinio(key: string): Promise<void> {
  if (!key) return
  await ensureResumeBucket()
  await getMinioClient().removeObject(bucketName(), key)
}
