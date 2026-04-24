import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const pool = getPostgresPool()
  const result = await pool.query(
    `SELECT n.*,
            to_jsonb(j.*) || jsonb_build_object('company', to_jsonb(c.*)) AS job,
            to_jsonb(a.*) AS alert
     FROM alert_notifications n
     LEFT JOIN jobs j ON j.id = n.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_alerts a ON a.id = n.alert_id
     ORDER BY n.sent_at DESC
     LIMIT 500`
  )
  return NextResponse.json({ notifications: result.rows })
}
