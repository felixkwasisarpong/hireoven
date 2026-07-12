import { redirect } from "next/navigation"
import ScheduledConfirmation from "@/components/interview/ScheduledConfirmation"
import { getSessionUser } from "@/lib/auth/session-user"
import { getInterviewSession } from "@/lib/apex/interview/queries"
import { getJobContext } from "@/lib/interview/scheduling"
import { PERSONA_LABELS } from "@/lib/interview/format"
import { resolveAppOrigin } from "@/lib/app-url"

export const dynamic = "force-dynamic"

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

  const { jobTitle, jobCompany } = await getJobContext(session.jobId)

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
          appOrigin={resolveAppOrigin()}
        />
      </div>
    </main>
  )
}
