import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import AdminSidebarNav, { AdminSidebarRealtimeTip } from "@/components/admin/AdminSidebarNav"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { requireAdminProfile } from "@/lib/admin/auth"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireAdminProfile()

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#111315_0%,#171A1F_16%,#EEF2F7_16%,#F5F7FB_100%)]">
      <div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex flex-col border-r border-white/5 bg-[#0f0f0f] text-white lg:sticky lg:top-0 lg:self-start lg:h-[calc(100dvh-2rem)] lg:max-h-[calc(100dvh-2rem)] lg:w-full lg:overflow-hidden">
          <div className="shrink-0 px-5 pt-6">
            <Link
              href="/admin"
              className="block rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            >
              <div className="rounded-lg bg-white/95 px-3 py-2.5">
                <HireovenLogo variant="header" className="h-9 w-auto max-w-[200px]" priority />
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-gray-400">
                Admin console
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-white">Admin</p>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                Mission control for jobs, crawls, users, alerts, and H1B data.
              </p>
            </Link>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-6 pt-6">
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] [-webkit-overflow-scrolling:touch] [scrollbar-color:rgba(255,255,255,0.2)_transparent]">
              <AdminSidebarNav />
            </div>
            <div className="shrink-0">
              <AdminSidebarRealtimeTip />
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-white/70 bg-white/88 px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Link
                  href="/admin"
                  className="mt-0.5 shrink-0 rounded-xl border border-gray-200/80 bg-white p-1.5 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                  aria-label="Admin home"
                >
                  <HireovenLogo variant="mark" className="h-9 w-9" />
                </Link>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
                    Hireoven Admin
                  </p>
                  <h1 className="mt-1 text-xl font-semibold text-gray-950">
                    Operations control center
                  </h1>
                </div>
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
