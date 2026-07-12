// Pure, client-safe helpers shared by the scheduling UI, the server-side
// scheduling/email code, and the reminder watcher. No server imports here —
// client components import this module directly.

/** Minutes before the scheduled start when the Join button unlocks. */
export const JOIN_OPENS_MINUTES = 10

/** How long after the scheduled start a session still counts as "joinable". */
export const JOIN_GRACE_MINUTES = 30

export const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Friendly recruiter",
  skeptical_hm: "Skeptical hiring manager",
  senior_staff: "Senior staff engineer",
  founder: "Founder",
  panel: "Panel",
}

export function roleLabel(
  jobTitle: string | null | undefined,
  jobCompany: string | null | undefined,
  fallback = "General practice"
): string {
  if (!jobTitle) return fallback
  return `${jobTitle}${jobCompany ? ` @ ${jobCompany}` : ""}`
}

export function countdownLabel(scheduledAtIso: string, now = Date.now()): string {
  const diffMin = Math.round((new Date(scheduledAtIso).getTime() - now) / 60_000)
  if (diffMin <= 0) return "starting now"
  if (diffMin < 60) return `in ${diffMin} min`
  const hours = Math.round(diffMin / 60)
  if (diffMin < 48 * 60) return `in ${hours} hour${hours === 1 ? "" : "s"}`
  return `in ${Math.round(diffMin / (60 * 24))} days`
}

export function isJoinOpen(scheduledAtIso: string, now = Date.now()): boolean {
  return now >= new Date(scheduledAtIso).getTime() - JOIN_OPENS_MINUTES * 60_000
}

/** Compact UTC timestamp (YYYYMMDDTHHMMSSZ) used by both ICS and Google Calendar. */
export function utcCalendarStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

export function buildGoogleCalendarUrl(input: {
  scheduledAt: Date
  durationMin: number
  joinUrl: string
  jobTitle?: string | null
  jobCompany?: string | null
}): string {
  const end = new Date(input.scheduledAt.getTime() + input.durationMin * 60_000)
  const title = `Live mock interview — ${roleLabel(input.jobTitle, input.jobCompany, "Hireoven")}`
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${utcCalendarStamp(input.scheduledAt)}/${utcCalendarStamp(end)}`,
    details: `Your ${input.durationMin}-minute live AI mock interview on Hireoven.\nJoin here: ${input.joinUrl}`,
    location: input.joinUrl,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
