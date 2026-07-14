import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    total_active: string
    total_inactive: string
    total_remote: string
    failed_normalization: string
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE is_active = true)                                        AS total_active,
      COUNT(*) FILTER (WHERE is_active = false)                                       AS total_inactive,
      COUNT(*) FILTER (WHERE is_active = true AND is_remote = true)                   AS total_remote,
      COUNT(*) FILTER (WHERE is_active = true AND (normalized_title IS NULL OR COALESCE(array_length(skills, 1), 0) = 0)) AS failed_normalization
    FROM jobs
  `)

  const row = rows[0]
  return NextResponse.json({
    totalActive: Number(row.total_active),
    totalInactive: Number(row.total_inactive),
    totalRemote: Number(row.total_remote),
    failedNormalization: Number(row.failed_normalization),
  })
}
