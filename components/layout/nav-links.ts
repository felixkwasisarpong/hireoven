import { BadgePercent, BookOpen, Briefcase, Building2, Puzzle, ShieldCheck, Sparkles } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavLink {
  href: string
  label: string
  icon: LucideIcon
}

/** Primary public nav — shared by the desktop header and the mobile menu so
 *  they can't drift out of sync. */
export const NAV_LINKS: NavLink[] = [
  { href: "/find", label: "Find Jobs", icon: Briefcase },
  { href: "/features", label: "Features", icon: Sparkles },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/h1b-sponsors/leaderboard", label: "H-1B Sponsors", icon: ShieldCheck },
  { href: "/pricing", label: "Pricing", icon: BadgePercent },
  { href: "/extension", label: "Extension", icon: Puzzle },
  { href: "/blog", label: "Blog", icon: BookOpen },
]
