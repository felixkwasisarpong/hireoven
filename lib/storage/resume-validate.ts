import {
  MAX_RESUME_SIZE_BYTES,
  isResumeFilename,
  isResumeMimeType,
} from "@/lib/resume/constants"

export function sanitizeFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
}

export function validateResumeFile(file: File) {
  const hasValidMimeType = isResumeMimeType(file.type)
  const hasValidName = isResumeFilename(file.name)

  if (!hasValidMimeType && !hasValidName) {
    throw new Error("Resume must be a PDF or DOCX file")
  }

  if (file.size > MAX_RESUME_SIZE_BYTES) {
    throw new Error("Resume must be 5MB or smaller")
  }
}

/** Object key inside the resume bucket (same shape as Supabase Storage paths). */
export function buildResumeStorageKey(userId: string, file: File) {
  const timestamp = Date.now()
  const safeName = sanitizeFileName(file.name)
  return `resumes/${userId}/${timestamp}-${safeName}`
}
