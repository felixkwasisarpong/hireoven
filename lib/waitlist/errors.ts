export function isMissingWaitlistTableError(message: string | null | undefined) {
  if (!message) return false
  const normalized = message.toLowerCase()
  return (
    normalized.includes("could not find the table 'public.waitlist'") ||
    (normalized.includes("relation") && normalized.includes("waitlist") && normalized.includes("does not exist"))
  )
}
