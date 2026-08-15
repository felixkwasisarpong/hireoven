"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { NAV_LINKS } from "./nav-links"

export default function MarketingNavLinks() {
  const pathname = usePathname()
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    setPendingHref(null)
  }, [pathname])

  const warmRoute = (href: string) => {
    if (href !== pathname) {
      router.prefetch(href)
    }
  }

  return (
    <div className="hidden items-center gap-1 lg:flex">
      {NAV_LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))
        const pending = pendingHref === href

        return (
          <Link
            key={href}
            href={href}
            onClick={() => setPendingHref(href)}
            onFocus={() => warmRoute(href)}
            onMouseEnter={() => warmRoute(href)}
            onPointerDown={() => setPendingHref(href)}
            onTouchStart={() => warmRoute(href)}
            prefetch
            className={`marketing-nav-link ${active ? "is-active" : ""} ${pending ? "is-pending" : ""}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span>{label}</span>
          </Link>
        )
      })}
    </div>
  )
}
