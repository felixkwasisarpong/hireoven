import { requireAdminProfile } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import WaitlistAdminPanel from "@/components/admin/WaitlistAdminPanel"
import type { Waitlist } from "@/types"

type WaitlistAdminRow = Pick<
  Waitlist,
  | "id"
  | "email"
  | "joined_at"
  | "is_international"
  | "visa_status"
  | "university"
  | "source"
  | "referrer"
  | "confirmed"
>

export default async function AdminWaitlistPage() {
  await requireAdminProfile()

  let rows: WaitlistAdminRow[] = []
  try {
    const pool = getPostgresPool()
    const result = await pool.query<WaitlistAdminRow>(
      `SELECT id, email, joined_at, is_international, visa_status, university, source, referrer, confirmed
       FROM waitlist
       ORDER BY joined_at DESC`
    )
    rows = result.rows
  } catch (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Could not load waitlist:{" "}
        {error instanceof Error ? error.message : "Database query failed"}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-950">Waitlist</h1>
        <p className="mt-1 text-sm text-gray-600">
          Pre-launch signups from <code className="rounded bg-gray-100 px-1">/launch</code> and
          tracked channels.
        </p>
      </div>
      <WaitlistAdminPanel initialRows={rows ?? []} />
    </div>
  )
}
