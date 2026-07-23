import { AlertTriangle } from "lucide-react"
import { getMaintenanceBanner } from "@/lib/admin/feature-flags"

/**
 * Server-rendered top-of-page banner. Returns null when the flag is off so
 * there's no layout shift in the steady state. Toggle via the admin
 * settings page (system_settings.maintenance_banner).
 */
export default async function MaintenanceBanner() {
  const banner = await getMaintenanceBanner()
  if (!banner.enabled || !banner.message.trim()) return null

  return (
    <div className="relative z-50 flex items-start justify-center gap-3 border-b border-[#f5a623]/40 bg-[#f5a623]/12 px-4 py-3 font-mono text-[#f5d9a3]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f5a623]" aria-hidden />
      <p className="max-w-3xl text-center text-[13.5px] font-medium leading-snug">
        {banner.message}
      </p>
    </div>
  )
}
