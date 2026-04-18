import { createAdminClient } from "@/lib/supabase/admin"
import {
  MAX_RESUME_SIZE_BYTES,
  isResumeFilename,
  isResumeMimeType,
} from "@/lib/resume/constants"

const RESUME_BUCKET = "resumes"

let bucketEnsured = false

function sanitizeFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
}

async function ensureResumesBucket() {
  if (bucketEnsured) return

  const supabase = createAdminClient()
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  if (listError) throw listError

  const exists = buckets?.some((bucket) => bucket.name === RESUME_BUCKET)

  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(RESUME_BUCKET, {
      public: false,
      fileSizeLimit: MAX_RESUME_SIZE_BYTES,
      allowedMimeTypes: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    })

    if (createError && !createError.message.toLowerCase().includes("already exists")) {
      throw createError
    }
  }

  bucketEnsured = true
}

function validateResumeFile(file: File) {
  const hasValidMimeType = isResumeMimeType(file.type)
  const hasValidName = isResumeFilename(file.name)

  if (!hasValidMimeType && !hasValidName) {
    throw new Error("Resume must be a PDF or DOCX file")
  }

  if (file.size > MAX_RESUME_SIZE_BYTES) {
    throw new Error("Resume must be 5MB or smaller")
  }
}

export async function uploadResume(
  userId: string,
  file: File
): Promise<{ url: string; path: string }> {
  validateResumeFile(file)
  await ensureResumesBucket()

  const supabase = createAdminClient()
  const timestamp = Date.now()
  const safeName = sanitizeFileName(file.name)
  const path = `resumes/${userId}/${timestamp}-${safeName}`
  const fileBuffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, fileBuffer, {
      contentType: file.type || undefined,
      upsert: false,
    })

  if (uploadError) throw uploadError

  const url = await getResumeUrl(path)
  return { url, path }
}

export async function deleteResume(path: string): Promise<void> {
  if (!path) return

  await ensureResumesBucket()
  const supabase = createAdminClient()
  const { error } = await supabase.storage.from(RESUME_BUCKET).remove([path])

  if (error) throw error
}

export async function getResumeUrl(path: string): Promise<string> {
  await ensureResumesBucket()
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(path, 60 * 60)

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to create signed resume URL")
  }

  return data.signedUrl
}
