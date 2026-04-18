export const MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024;

export const RESUME_ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const RESUME_ACCEPTED_EXTENSIONS = ['.pdf', '.docx'] as const;

export function isResumeFilename(fileName: string) {
  const lower = fileName.toLowerCase();
  return RESUME_ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isResumeMimeType(mimeType: string) {
  return (RESUME_ACCEPTED_TYPES as readonly string[]).includes(mimeType);
}
