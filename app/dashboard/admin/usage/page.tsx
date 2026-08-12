import { requireAdminProfile } from "@/lib/admin/auth"
import ApexUsageDashboard from "./UsageClient"

export const dynamic = "force-dynamic"

// Admin-only console (AI cost/usage/token data). Guard server-side with the
// standard is_admin check — the same requireAdminProfile() that app/(admin)/admin
// uses — so it isn't reachable by any logged-in user. Previously this route had
// only middleware login-gating, not an admin-role check.
export default async function AdminUsagePage() {
  await requireAdminProfile()
  return <ApexUsageDashboard />
}
