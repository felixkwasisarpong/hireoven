import {
  buildResumeStorageKey,
  validateResumeFile,
} from "@/lib/storage/resume-validate"
import {
  deleteResumeMinio,
  isResumeMinioConfigured,
  presignResumeGetMinio,
  uploadResumeMinio,
} from "@/lib/storage/resume-minio"

function requireResumeStorage(): void {
  if (!isResumeMinioConfigured()) {
    throw new Error(
      "Resume storage requires MinIO (S3-compatible) env: MINIO_BUCKET, MINIO_ACCESS_KEY (or MINIO_ROOT_USER), MINIO_SECRET_KEY (or MINIO_ROOT_PASSWORD); optional MINIO_ENDPOINT"
    )
  }
}

/** @deprecated Use isResumeStorageMinio — name kept for compatibility */
export function isResumeStorageS3(): boolean {
  return isResumeMinioConfigured()
}

export function isResumeStorageMinio(): boolean {
  return isResumeMinioConfigured()
}

export async function uploadResume(
  userId: string,
  file: File
): Promise<{ url: string; path: string }> {
  validateResumeFile(file)
  const path = buildResumeStorageKey(userId, file)
  requireResumeStorage()
  return uploadResumeMinio(path, file)
}

export async function deleteResume(path: string): Promise<void> {
  if (!path) return
  requireResumeStorage()
  await deleteResumeMinio(path)
}

export async function getResumeUrl(path: string): Promise<string> {
  requireResumeStorage()
  return presignResumeGetMinio(path)
}
