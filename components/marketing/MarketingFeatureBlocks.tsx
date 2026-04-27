import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type CoreRow = {
  icon: LucideIcon
  title: string
  body: string
  accent: string
  ring: string
}

export function CoreFeaturesTable({ features }: { features: CoreRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <ul className="divide-y divide-gray-100">
        {features.map(({ icon: Icon, title, body, accent, ring }) => (
          <li key={title} className="flex gap-4 p-5 sm:gap-5 sm:p-6">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
                ring
              )}
            >
              <Icon className={cn("h-5 w-5", accent)} aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

type IntlRow = {
  icon: LucideIcon
  title: string
  body: string
}

export function InternationalFeaturesTable({
  items,
  showDisclaimer = true,
}: {
  items: IntlRow[]
  showDisclaimer?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#BAE6FD] bg-white shadow-sm">
      <ul className="divide-y divide-[#E0F2FE]">
        {items.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4 p-5 sm:gap-5 sm:p-6">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E0F2FE]">
              <Icon className="h-5 w-5 text-[#0369A1]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      {showDisclaimer ? (
        <div className="border-t border-[#E0F2FE] bg-[#F0F9FF] px-5 py-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
            Not legal advice
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[#0C4A6E]">
            Our signals help you prioritize where to apply and what to verify. For anything binding on
            your case, talk to your DSO or an immigration attorney.
          </p>
        </div>
      ) : null}
    </div>
  )
}
