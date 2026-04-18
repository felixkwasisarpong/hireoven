import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import AdminSidebarNav from "@/components/admin/AdminSidebarNav"
import { requireAdminProfile } from "@/lib/admin/auth"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireAdminProfile()

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-r border-white/5 bg-[#0f0f0f] px-5 py-6 text-white">
          <Link href="/admin" className="block rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gray-400">
              Hireoven
            </p>
            <p className="mt-2 text-2xl font-semibold">Admin</p>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              Mission control for jobs, crawls, users, alerts, and H1B data.
            </p>
          </Link>

          <div className="mt-6">
            <AdminSidebarNav />
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 px-5 py-4 backdrop-blur">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
                  Hireoven Admin
                </p>
                <h1 className="mt-1 text-xl font-semibold text-gray-950">
                  Operations control center
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
                  Signed in as{" "}
                  <span className="font-semibold text-gray-900">
                    {profile.full_name ?? profile.email ?? "Admin"}
                  </span>
                </div>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  View site
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </header>

          <main className="px-4 py-6 lg:px-6">{children}</main>
        </div>
      </div>
    </div>
  )
}
