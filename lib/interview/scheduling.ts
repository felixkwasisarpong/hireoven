import type { Pool, PoolClient } from 'pg'
import { getPostgresPool } from '@/lib/postgres/server'
import { JOIN_GRACE_MINUTES, utcCalendarStamp } from '@/lib/interview/format'

// Live-interview scheduling: slot suggestions ranked by system load, booking
// helpers, reminder rows for the delivery cron, and ICS generation.
//
// A scheduled session is a normal live session in status 'setup' with
// scheduled_at set — the join flow (setup → active on realtime-token) is
// untouched, so a user can also join a few minutes early.

// ─── Constants ────────────────────────────────────────────────────────────────

/** Slots with this many overlapping bookings are closed for new bookings. */
export const MAX_CONCURRENT_LIVE_SESSIONS = 8

export const SLOT_STEP_MINUTES = 30
export const DAY_START_HOUR = 8 // candidate slots run 08:00–21:30 local
export const DAY_END_HOUR = 22
export const MIN_LEAD_MINUTES = 15
export const MAX_ADVANCE_DAYS = 30

export { JOIN_GRACE_MINUTES }

export const REMINDER_OFFSETS: { kind: ReminderKind; minutesBefore: number }[] = [
  { kind: 'day_before', minutesBefore: 24 * 60 },
  { kind: 'hour_before', minutesBefore: 60 },
  { kind: 'starting_soon', minutesBefore: 10 },
]

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReminderKind = 'day_before' | 'hour_before' | 'starting_soon'

export type SlotBusyness = 'low' | 'medium' | 'high'

export interface SlotSuggestion {
  /** Slot start, ISO-8601 UTC. */
  startsAt: string
  busyness: SlotBusyness
  /** Slot is open for booking (below concurrency capacity). */
  available: boolean
  /** One of the least-busy open slots for the day. */
  recommended: boolean
}

export interface UpcomingScheduledSession {
  id: string
  scheduledAt: Date
  scheduledTimezone: string | null
  durationTargetMin: number
  persona: string
  questionSet: string
  jobTitle: string | null
  jobCompany: string | null
}

export interface DueReminder {
  id: string
  sessionId: string
  userId: string
  kind: ReminderKind
  scheduledAt: Date
  durationTargetMin: number
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────
// Wall-clock math in the user's IANA timezone without a date library.

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Intl.DateTimeFormat construction is expensive (ICU data load) and
// suggestSlotsForDay needs 2-3 offset lookups per slot — cache per zone.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
    zoneFormatters.set(timeZone, formatter)
  }
  return formatter
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  )
  return asUtc - utcMs
}

/** Instant for a wall-clock time (y/m/d hh:mm) in the given IANA zone. */
export function zonedTimeToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  let offset = timeZoneOffsetMs(guess, timeZone)
  // Second pass handles DST transitions near the guess.
  const adjusted = timeZoneOffsetMs(guess - offset, timeZone)
  if (adjusted !== offset) offset = adjusted
  return new Date(guess - offset)
}

// ─── Slot suggestions ─────────────────────────────────────────────────────────

/**
 * Suggest bookable slots for one calendar day (in the user's timezone), ranked
 * by how busy the system is: confirmed future bookings that overlap the slot,
 * plus the historical rate of live sessions started at that hour (UTC) over
 * the past 30 days. The least-loaded open slots are flagged `recommended`.
 */
export async function suggestSlotsForDay(input: {
  /** Calendar day in the user's timezone, formatted YYYY-MM-DD. */
  date: string
  timeZone: string
  durationMin: number
}): Promise<SlotSuggestion[]> {
  const [year, month, day] = input.date.split('-').map(Number)
  const durationMs = input.durationMin * 60_000

  const slotStarts: Date[] = []
  for (let hour = DAY_START_HOUR; hour < DAY_END_HOUR; hour++) {
    for (let minute = 0; minute < 60; minute += SLOT_STEP_MINUTES) {
      slotStarts.push(zonedTimeToUtc(year, month, day, hour, minute, input.timeZone))
    }
  }

  const minStart = Date.now() + MIN_LEAD_MINUTES * 60_000
  const candidates = slotStarts.filter((d) => d.getTime() >= minStart)
  if (candidates.length === 0) return []

  const windowStart = candidates[0]
  const windowEnd = new Date(candidates[candidates.length - 1].getTime() + durationMs)

  const pool = getPostgresPool()
  const [bookedResult, historyResult] = await Promise.all([
    pool.query<{ scheduled_at: string; duration_target_min: number }>(
      // The lower bound on scheduled_at itself (durations are ≤60 min) keeps
      // the partial index usable instead of scanning all historical rows.
      `SELECT scheduled_at, duration_target_min
       FROM interview_sessions
       WHERE type = 'live'
         AND status = 'setup'
         AND scheduled_at IS NOT NULL
         AND scheduled_at < $2
         AND scheduled_at > $1::timestamptz - INTERVAL '60 minutes'
         AND scheduled_at + (duration_target_min * INTERVAL '1 minute') > $1`,
      [windowStart.toISOString(), windowEnd.toISOString()],
    ),
    pool.query<{ hour: number; count: string }>(
      // AT TIME ZONE 'UTC' pins the bucket to UTC hours regardless of the
      // connection's TimeZone — the lookup below uses getUTCHours().
      `SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE 'UTC')::int AS hour, COUNT(*)::text AS count
       FROM interview_sessions
       WHERE type = 'live'
         AND started_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1`,
      [],
    ),
  ])

  const bookings = bookedResult.rows.map((row) => {
    const start = new Date(row.scheduled_at).getTime()
    return { start, end: start + row.duration_target_min * 60_000 }
  })
  const historyByUtcHour = new Map<number, number>(
    historyResult.rows.map((row) => [row.hour, Number(row.count) / 30]),
  )

  const scored = candidates.map((startsAt) => {
    const start = startsAt.getTime()
    const end = start + durationMs
    const booked = bookings.filter((b) => b.start < end && b.end > start).length
    const historical = historyByUtcHour.get(startsAt.getUTCHours()) ?? 0
    return {
      startsAt,
      booked,
      // Confirmed bookings dominate; history breaks ties between empty slots.
      load: booked * 1.5 + historical,
    }
  })

  const loads = scored.map((s) => s.load)
  const minLoad = Math.min(...loads)
  const maxLoad = Math.max(...loads)
  const range = maxLoad - minLoad

  const busynessOf = (load: number): SlotBusyness => {
    if (range < 0.001) return 'low'
    const ratio = (load - minLoad) / range
    if (ratio <= 1 / 3) return 'low'
    if (ratio <= 2 / 3) return 'medium'
    return 'high'
  }

  const recommendedIds = new Set(
    [...scored]
      .filter((s) => s.booked < MAX_CONCURRENT_LIVE_SESSIONS)
      .sort((a, b) => a.load - b.load || a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, 4)
      .map((s) => s.startsAt.getTime()),
  )

  return scored.map((s) => ({
    startsAt: s.startsAt.toISOString(),
    busyness: busynessOf(s.load),
    available: s.booked < MAX_CONCURRENT_LIVE_SESSIONS,
    recommended: recommendedIds.has(s.startsAt.getTime()),
  }))
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export type ScheduleValidation =
  | { ok: true; scheduledAt: Date }
  | { ok: false; error: string }

export function validateScheduledAt(raw: unknown): ScheduleValidation {
  if (typeof raw !== 'string') return { ok: false, error: 'scheduledAt must be an ISO date string' }
  const scheduledAt = new Date(raw)
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: 'scheduledAt is not a valid date' }
  }
  if (scheduledAt.getTime() < Date.now() + MIN_LEAD_MINUTES * 60_000) {
    return { ok: false, error: `Pick a time at least ${MIN_LEAD_MINUTES} minutes from now` }
  }
  if (scheduledAt.getTime() > Date.now() + MAX_ADVANCE_DAYS * 24 * 3_600_000) {
    return { ok: false, error: `Interviews can be scheduled up to ${MAX_ADVANCE_DAYS} days ahead` }
  }
  return { ok: true, scheduledAt }
}

/** Count confirmed bookings overlapping [scheduledAt, scheduledAt + duration). */
async function countOverlapping(
  db: Pool | PoolClient,
  scheduledAt: Date,
  durationMin: number,
  excludeSessionId?: string,
): Promise<number> {
  const end = new Date(scheduledAt.getTime() + durationMin * 60_000)
  const params: unknown[] = [scheduledAt.toISOString(), end.toISOString()]
  let exclude = ''
  if (excludeSessionId) {
    params.push(excludeSessionId)
    exclude = `AND id != $${params.length}`
  }
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM interview_sessions
     WHERE type = 'live'
       AND status = 'setup'
       AND scheduled_at IS NOT NULL
       AND scheduled_at < $2
       AND scheduled_at > $1::timestamptz - INTERVAL '60 minutes'
       AND scheduled_at + (duration_target_min * INTERVAL '1 minute') > $1
       ${exclude}`,
    params,
  )
  return Number(result.rows[0]?.count ?? 0)
}

// Capacity checks and their insert/update must be atomic or concurrent
// bookings for the last opening both pass the count. A single advisory lock
// serializes bookings; slot volume makes contention negligible.
const BOOKING_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('interview_slot_booking'))`

export type BookingResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'slot_full' }

/** Create a scheduled live session, enforcing slot capacity atomically. */
export async function bookScheduledLiveSession(input: {
  userId: string
  jobId: string | null
  persona: string
  questionSet: string
  durationTargetMin: number
  useResumeContext: boolean
  scheduledAt: Date
  scheduledTimezone: string | null
}): Promise<BookingResult> {
  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(BOOKING_LOCK_SQL)
    const overlapping = await countOverlapping(client, input.scheduledAt, input.durationTargetMin)
    if (overlapping >= MAX_CONCURRENT_LIVE_SESSIONS) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'slot_full' }
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO interview_sessions
         (user_id, job_id, type, persona, question_set, duration_target_min,
          use_resume_context, scheduled_at, scheduled_timezone)
       VALUES ($1, $2, 'live', $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.userId,
        input.jobId,
        input.persona,
        input.questionSet,
        input.durationTargetMin,
        input.useResumeContext,
        input.scheduledAt.toISOString(),
        input.scheduledTimezone,
      ],
    )
    await client.query('COMMIT')
    return { ok: true, sessionId: inserted.rows[0].id }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Move a booking to a new slot, enforcing slot capacity atomically. */
export async function rescheduleScheduledSession(input: {
  sessionId: string
  userId: string
  durationTargetMin: number
  scheduledAt: Date
  scheduledTimezone: string | null
}): Promise<BookingResult> {
  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(BOOKING_LOCK_SQL)
    const overlapping = await countOverlapping(
      client,
      input.scheduledAt,
      input.durationTargetMin,
      input.sessionId,
    )
    if (overlapping >= MAX_CONCURRENT_LIVE_SESSIONS) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'slot_full' }
    }
    await client.query(
      `UPDATE interview_sessions
       SET scheduled_at = $3, scheduled_timezone = $4
       WHERE id = $1 AND user_id = $2`,
      [input.sessionId, input.userId, input.scheduledAt.toISOString(), input.scheduledTimezone],
    )
    await client.query('COMMIT')
    return { ok: true, sessionId: input.sessionId }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** The user's not-yet-started scheduled live bookings (for credit gating). */
export async function countPendingScheduledSessions(userId: string): Promise<number> {
  const pool = getPostgresPool()
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM interview_sessions
     WHERE user_id = $1
       AND type = 'live'
       AND status = 'setup'
       AND scheduled_at IS NOT NULL
       AND scheduled_at > NOW()`,
    [userId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

export interface AdminScheduledSession {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  scheduledAt: Date
  scheduledTimezone: string | null
  durationTargetMin: number
  persona: string
  questionSet: string
  jobTitle: string | null
  jobCompany: string | null
  remindersSent: number
  createdAt: Date
}

/** All users' upcoming scheduled live interviews — admin console view. */
export async function adminListUpcomingScheduled(limit = 200): Promise<AdminScheduledSession[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT s.id, s.user_id, s.scheduled_at, s.scheduled_timezone, s.duration_target_min,
            s.persona, s.question_set, s.created_at,
            p.email AS user_email, p.full_name AS user_name,
            j.title AS job_title, c.name AS job_company,
            (SELECT COUNT(*) FROM interview_reminders r
             WHERE r.session_id = s.id AND r.sent_at IS NOT NULL)::int AS reminders_sent
     FROM interview_sessions s
     LEFT JOIN profiles p ON p.id = s.user_id
     LEFT JOIN jobs j ON j.id = s.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE s.type = 'live'
       AND s.status = 'setup'
       AND s.scheduled_at IS NOT NULL
       AND s.scheduled_at > NOW() - ($2 * INTERVAL '1 minute')
     ORDER BY s.scheduled_at ASC
     LIMIT $1`,
    [limit, JOIN_GRACE_MINUTES],
  )
  return result.rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    userEmail: (row.user_email as string | null) ?? null,
    userName: (row.user_name as string | null) ?? null,
    scheduledAt: new Date(row.scheduled_at as string),
    scheduledTimezone: (row.scheduled_timezone as string | null) ?? null,
    durationTargetMin: row.duration_target_min as number,
    persona: row.persona as string,
    questionSet: row.question_set as string,
    jobTitle: (row.job_title as string | null) ?? null,
    jobCompany: (row.job_company as string | null) ?? null,
    remindersSent: row.reminders_sent as number,
    createdAt: new Date(row.created_at as string),
  }))
}

/** Job title/company for confirmation surfaces (emails, ICS, pages). */
export async function getJobContext(
  jobId: string | null,
): Promise<{ jobTitle: string | null; jobCompany: string | null }> {
  if (!jobId) return { jobTitle: null, jobCompany: null }
  const pool = getPostgresPool()
  const result = await pool.query<{ title: string | null; company_name: string | null }>(
    `SELECT j.title, c.name AS company_name
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1
     LIMIT 1`,
    [jobId],
  )
  return {
    jobTitle: result.rows[0]?.title ?? null,
    jobCompany: result.rows[0]?.company_name ?? null,
  }
}

export async function listUpcomingScheduledSessions(
  userId: string,
): Promise<UpcomingScheduledSession[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT s.id, s.scheduled_at, s.scheduled_timezone, s.duration_target_min,
            s.persona, s.question_set,
            j.title AS job_title, c.name AS job_company
     FROM interview_sessions s
     LEFT JOIN jobs j ON j.id = s.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE s.user_id = $1
       AND s.type = 'live'
       AND s.status = 'setup'
       AND s.scheduled_at IS NOT NULL
       AND s.scheduled_at > NOW() - ($2 * INTERVAL '1 minute')
     ORDER BY s.scheduled_at ASC
     LIMIT 20`,
    [userId, JOIN_GRACE_MINUTES],
  )
  return result.rows.map((row) => ({
    id: row.id as string,
    scheduledAt: new Date(row.scheduled_at as string),
    scheduledTimezone: (row.scheduled_timezone as string | null) ?? null,
    durationTargetMin: row.duration_target_min as number,
    persona: row.persona as string,
    questionSet: row.question_set as string,
    jobTitle: (row.job_title as string | null) ?? null,
    jobCompany: (row.job_company as string | null) ?? null,
  }))
}

// ─── Reminders ────────────────────────────────────────────────────────────────

/** (Re)create reminder rows for a booked session; past offsets are skipped. */
export async function resetRemindersForSession(
  sessionId: string,
  userId: string,
  scheduledAt: Date,
): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `DELETE FROM interview_reminders WHERE session_id = $1 AND sent_at IS NULL`,
    [sessionId],
  )
  const now = Date.now()
  const future = REMINDER_OFFSETS
    .map(({ kind, minutesBefore }) => ({
      kind,
      remindAt: new Date(scheduledAt.getTime() - minutesBefore * 60_000),
    }))
    .filter(({ remindAt }) => remindAt.getTime() > now)
  if (future.length === 0) return
  await pool.query(
    `INSERT INTO interview_reminders (session_id, user_id, kind, remind_at)
     SELECT $1, $2, kind, remind_at
     FROM unnest($3::text[], $4::timestamptz[]) AS t(kind, remind_at)
     ON CONFLICT (session_id, kind) DO UPDATE SET remind_at = EXCLUDED.remind_at, sent_at = NULL`,
    [
      sessionId,
      userId,
      future.map((f) => f.kind),
      future.map((f) => f.remindAt.toISOString()),
    ],
  )
}

/** Due, unsent reminders whose session is still an upcoming scheduled booking. */
export async function listDueReminders(limit = 200): Promise<DueReminder[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT r.id, r.session_id, r.user_id, r.kind,
            s.scheduled_at, s.duration_target_min
     FROM interview_reminders r
     JOIN interview_sessions s ON s.id = r.session_id
     WHERE r.sent_at IS NULL
       AND r.remind_at <= NOW()
       AND s.status = 'setup'
       AND s.scheduled_at IS NOT NULL
       AND s.scheduled_at > NOW() - ($2 * INTERVAL '1 minute')
     ORDER BY r.remind_at ASC
     LIMIT $1`,
    [limit, JOIN_GRACE_MINUTES],
  )
  return result.rows.map((row) => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    userId: row.user_id as string,
    kind: row.kind as ReminderKind,
    scheduledAt: new Date(row.scheduled_at as string),
    durationTargetMin: row.duration_target_min as number,
  }))
}

// ─── ICS calendar file ────────────────────────────────────────────────────────

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function buildInterviewIcs(input: {
  sessionId: string
  scheduledAt: Date
  durationMin: number
  joinUrl: string
  jobTitle?: string | null
  jobCompany?: string | null
}): string {
  const end = new Date(input.scheduledAt.getTime() + input.durationMin * 60_000)
  const summary = input.jobTitle
    ? `Live mock interview — ${input.jobTitle}${input.jobCompany ? ` @ ${input.jobCompany}` : ''}`
    : 'Live mock interview — Hireoven'
  const description =
    `Your ${input.durationMin}-minute live AI mock interview on Hireoven.\n` +
    `Join here: ${input.joinUrl}`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hireoven//Interview Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:interview-${input.sessionId}@hireoven.app`,
    `DTSTAMP:${utcCalendarStamp(new Date())}`,
    `DTSTART:${utcCalendarStamp(input.scheduledAt)}`,
    `DTEND:${utcCalendarStamp(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${icsEscape(input.joinUrl)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Your Hireoven live interview starts in 30 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}
