import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { isMissingWaitlistTableError } from "@/lib/waitlist/errors"

export async function GET(request: Request) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format")

  const pool = getPostgresPool()
  let list: Array<{
    id: string
    email: string
    source: string | null
    referrer: string | null
    is_international: boolean | null
    visa_status: string | null
    university: string | null
    metadata: Record<string, unknown> | null
    confirmed: boolean
    joined_at: string
  }> = []

  try {
    const result = await pool.query<{
      id: string
      email: string
      source: string | null
      referrer: string | null
      is_international: boolean | null
      visa_status: string | null
      university: string | null
      metadata: Record<string, unknown> | null
      confirmed: boolean
      joined_at: string
    }>(
      `SELECT id, email, source, referrer, is_international, visa_status, university, metadata, confirmed, joined_at
       FROM waitlist
       ORDER BY joined_at DESC`
    )
    list = result.rows
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database query failed"
    if (isMissingWaitlistTableError(message)) {
      return NextResponse.json(
        {
          error:
            "Waitlist table is not available in this database yet. Run latest schema migration for public.waitlist.",
        },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (format === "csv") {
    const header = [
      "email",
      "joined_at",
      "international",
      "visa_status",
      "university",
      "source",
      "confirmed",
    ]
    const lines = [
      header.join(","),
      ...list.map((r) =>
        [
          csvEscape(r.email),
          csvEscape(r.joined_at),
          r.is_international === true ? "Y" : r.is_international === false ? "N" : "",
          csvEscape(r.visa_status ?? ""),
          csvEscape(r.university ?? ""),
          csvEscape(r.source ?? ""),
          r.confirmed ? "Y" : "N",
        ].join(",")
      ),
    ]
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="waitlist.csv"',
      },
    })
  }

  return NextResponse.json({ rows: list })
}

function csvEscape(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
