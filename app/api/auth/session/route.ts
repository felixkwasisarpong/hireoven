import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"

export const runtime = "nodejs"

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ user: null })
  }
  return NextResponse.json({ user: { id: user.sub, email: user.email } })
}
