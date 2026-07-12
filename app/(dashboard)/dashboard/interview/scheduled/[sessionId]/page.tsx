import { redirect } from "next/navigation"
import ScheduledConfirmation from "@/components/interview/ScheduledConfirmation"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { getInterviewSession } from "@/lib/apex/interview/queries"
import { buildGoogleCalendarUrl } from "@/lib/interview/confirmation-email"

export const dynamic = "force-dynamic"

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Friendly recruiter",
  skeptical_hm: "Skeptical hiring manager",
  senior_staff: "Senior staff engineer",
  founder: "Founder",
  panel: "Panel",
}

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

export default async function ScheduledInterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params

  const user = await getSessionUser()
  if (!user?.sub) redirect("/auth/login")

  const session = await getInterviewSession(sessionId, user.sub)
  if (!session || session.type !== "live" || !session.scheduledAt) {
    redirect("/dashboard/interview")
  }
  if (session.status !== "setup") {
    // Already started, finished, or cancelled — nothing to manage here.
    redirect("/dashboard/interview")
  }

  let jobTitle: string | null = null
  let jobCompany: string | null = null
  if (session.jobId) {
    const pool = getPostgresPool()
    const result = await pool.query<{ title: string | null; company_name: string | null }>(
      `SELECT j.title, c.name AS company_name
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1
       LIMIT 1`,
      [session.jobId]
    )
    jobTitle = result.rows[0]?.title ?? null
    jobCompany = result.rows[0]?.company_name ?? null
  }

  const googleCalendarUrl = buildGoogleCalendarUrl({
    scheduledAt: session.scheduledAt,
    durationMin: session.durationTargetMin,
    joinUrl: `${getBaseUrl()}/dashboard/interview/live/${session.id}`,
    jobTitle,
    jobCompany,
  })

  return (
    <main className="min-h-full bg-[#fbfcfd]">
      <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-5 lg:py-10">
        <ScheduledConfirmation
          sessionId={session.id}
          scheduledAt={session.scheduledAt.toISOString()}
          durationMin={session.durationTargetMin}
          personaLabel={PERSONA_LABELS[session.persona] ?? session.persona}
          jobTitle={jobTitle}
          jobCompany={jobCompany}
          googleCalendarUrl={googleCalendarUrl}
        />
      </div>
    </main>
  )
}
