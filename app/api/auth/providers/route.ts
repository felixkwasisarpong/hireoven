import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET() {
  const google = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  )
  return NextResponse.json({ google })
}
