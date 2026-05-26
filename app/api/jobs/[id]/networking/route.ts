import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getJobNetworkingContacts } from "@/lib/networking/job-contact-finder"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser()
  if (!session?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    const payload = await getJobNetworkingContacts({
      jobId: id,
      userId: session.sub,
    })
    return NextResponse.json(payload)
  } catch (error) {
    console.error("[api/jobs/[id]/networking] failed", error)
    return NextResponse.json({ error: "Failed to load networking contacts" }, { status: 500 })
  }
}
