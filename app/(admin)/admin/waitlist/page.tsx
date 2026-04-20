import { requireAdminProfile } from "@/lib/admin/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import WaitlistAdminPanel from "@/components/admin/WaitlistAdminPanel"

export default async function AdminWaitlistPage() {
  await requireAdminProfile()

  const supabase = createAdminClient()
  const { data: rows, error } = await supabase
    .from("waitlist")
    .select(
      "id, email, joined_at, is_international, visa_status, university, source, referrer, confirmed"
    )
    .order("joined_at", { ascending: false })

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Could not load waitlist: {error.message}
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
