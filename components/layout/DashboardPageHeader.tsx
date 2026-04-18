"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"

type DashboardPageHeaderProps = {
  kicker: string
  title: string
  description?: string
  backHref?: string
  backLabel?: string
  actions?: React.ReactNode
  meta?: React.ReactNode
  className?: string
}

export default function DashboardPageHeader({
  kicker,
  title,
  description,
  backHref,
  backLabel = "Back to dashboard",
  actions,
  meta,
  className,
}: DashboardPageHeaderProps) {
  return (
    <section className={cn("surface-hero px-5 py-5 md:px-6 md:py-6", className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {backHref ? (
            <Link href={backHref} className="subpage-back mb-3">
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          ) : null}

          <p className="section-kicker">{kicker}</p>
          <h1 className="section-title mt-2.5">{title}</h1>
          {description ? <p className="section-copy mt-2.5 max-w-2xl">{description}</p> : null}
        </div>

        {(meta || actions) && (
          <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
            {meta}
            {actions}
          </div>
        )}
      </div>
    </section>
  )
}
