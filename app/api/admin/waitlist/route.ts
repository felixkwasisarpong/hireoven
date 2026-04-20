import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { isMissingWaitlistTableError } from "@/lib/waitlist/errors"

export async function GET(request: Request) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format")

  let supabase
  try {
    supabase = createAdminClient()
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    )
  }

  const { data: rows, error } = await supabase
    .from("waitlist")
    .select(
      "id, email, source, referrer, is_international, visa_status, university, metadata, confirmed, joined_at"
    )
    .order("joined_at", { ascending: false })

  if (error) {
    if (isMissingWaitlistTableError(error.message)) {
      return NextResponse.json(
        {
          error:
            "Waitlist table is not available in this database yet. Run latest schema migration for public.waitlist.",
        },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const list = rows ?? []

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
