/**
 * Webcam snapshot storage for live interviews.
 * Reuses the MinIO client already configured for resume storage.
 *
 * Lifecycle note: 30-day auto-delete is a manual TODO on the MinIO bucket.
 * Set a lifecycle rule for the `interviews/` prefix in MinIO Console or via:
 *   mc ilm rule add --expire-days 30 ALIAS/BUCKET --prefix "interviews/"
 */
import * as Minio from "minio"

let client: Minio.Client | null = null

function getClient(): Minio.Client {
  if (client) return client
  const raw = process.env.MINIO_ENDPOINT?.trim() || "http://127.0.0.1:9000"
  const withProto = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`
  const url = new URL(withProto)
  const useSSL = url.protocol === "https:"
  const port = url.port ? Number(url.port) : useSSL ? 443 : 9000

  client = new Minio.Client({
    endPoint: url.hostname,
    port,
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY?.trim() || process.env.MINIO_ROOT_USER?.trim() || "",
    secretKey: process.env.MINIO_SECRET_KEY?.trim() || process.env.MINIO_ROOT_PASSWORD?.trim() || "",
    pathStyle: process.env.MINIO_PATH_STYLE !== "false",
  })
  return client
}

function bucketName(): string {
  const b = process.env.MINIO_BUCKET?.trim()
  if (!b) throw new Error("MINIO_BUCKET is required for snapshot storage")
  return b
}

export function isSnapshotStorageConfigured(): boolean {
  return Boolean(
    process.env.MINIO_BUCKET?.trim() &&
    (process.env.MINIO_ACCESS_KEY?.trim() || process.env.MINIO_ROOT_USER?.trim())
  )
}

export async function uploadInterviewSnapshot(
  userId: string,
  sessionId: string,
  jpegBuffer: Buffer
): Promise<{ url: string; key: string }> {
  const mc = getClient()
  const bucket = bucketName()
  const key = `interviews/${userId}/${sessionId}/${Date.now()}.jpg`

  await mc.putObject(bucket, key, jpegBuffer, jpegBuffer.length, {
    "Content-Type": "image/jpeg",
  })

  // 7-day presigned URL for debrief use
  const url = await mc.presignedGetObject(bucket, key, 7 * 24 * 60 * 60)
  return { url, key }
}
