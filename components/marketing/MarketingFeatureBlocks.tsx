import type { LucideIcon } from "lucide-react"

type CoreRow = {
  icon: LucideIcon
  title: string
  body: string
  accent: string
  ring: string
}

export function CoreFeaturesTable({ features }: { features: CoreRow[] }) {
  return (
    <div className="term-panel overflow-hidden">
      <ul className="divide-y divide-[rgba(120,200,160,0.12)]">
        {features.map(({ icon: Icon, title, body }) => (
          <li key={title} className="term-panel-hover flex gap-4 bg-[#0e1411] p-5 sm:gap-5 sm:p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
              <Icon className="h-5 w-5 text-[#f5a623]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#ccd6cf]/65">{body}</p>
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
    <div className="term-panel overflow-hidden">
      <ul className="divide-y divide-[rgba(120,200,160,0.12)]">
        {items.map(({ icon: Icon, title, body }) => (
          <li key={title} className="term-panel-hover flex gap-4 bg-[#0e1411] p-5 sm:gap-5 sm:p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#f5a623]/25 bg-[#f5a623]/10">
              <Icon className="h-5 w-5 text-[#f5a623]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#ccd6cf]/65">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      {showDisclaimer ? (
        <div className="border-t border-[#f5a623]/25 bg-[#f5a623]/10 px-5 py-4 sm:px-6">
          <p className="term-label text-[#f5a623]">Not legal advice</p>
          <p className="mt-1 text-sm leading-relaxed text-[#ccd6cf]/70">
            Our signals help you prioritize where to apply and what to verify. For anything binding on
            your case, talk to your DSO or an immigration attorney.
          </p>
        </div>
      ) : null}
    </div>
  )
}
