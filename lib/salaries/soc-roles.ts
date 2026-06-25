import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export interface SocRole {
  soc_group: string // "15-12"
  label: string // "Software Developers"
  short_label: string // "Software Dev"
  slug: string // "software-developers"
  family: string | null
}

const SELECT = `SELECT soc_group, label, short_label, slug, family FROM soc_group_labels`

export async function getSocRoleBySlug(slug: string): Promise<SocRole | null> {
  if (!hasPostgresEnv()) return null
  const { rows } = await getPostgresPool().query<SocRole>(`${SELECT} WHERE slug = $1 LIMIT 1`, [slug])
  return rows[0] ?? null
}

export async function getSocRoleByCode(socGroup: string): Promise<SocRole | null> {
  if (!hasPostgresEnv()) return null
  const { rows } = await getPostgresPool().query<SocRole>(`${SELECT} WHERE soc_group = $1 LIMIT 1`, [socGroup])
  return rows[0] ?? null
}

export async function getFeaturedSocRoles(): Promise<SocRole[]> {
  if (!hasPostgresEnv()) return []
  const { rows } = await getPostgresPool().query<SocRole>(
    `${SELECT} WHERE is_featured = true ORDER BY label`
  )
  return rows
}

export async function getAllSocRoles(): Promise<SocRole[]> {
  if (!hasPostgresEnv()) return []
  const { rows } = await getPostgresPool().query<SocRole>(`${SELECT} ORDER BY label`)
  return rows
}

export async function getAllSocRoleSlugs(): Promise<string[]> {
  const roles = await getFeaturedSocRoles()
  return roles.map((r) => r.slug)
}

// Look up labels + slugs for a set of soc_groups (for breakdown rendering).
export async function getSocLabelMap(
  socGroups: string[]
): Promise<Map<string, { label: string; slug: string }>> {
  const out = new Map<string, { label: string; slug: string }>()
  if (!hasPostgresEnv() || socGroups.length === 0) return out
  const { rows } = await getPostgresPool().query<{ soc_group: string; label: string; slug: string }>(
    `SELECT soc_group, label, slug FROM soc_group_labels WHERE soc_group = ANY($1)`,
    [socGroups]
  )
  for (const r of rows) out.set(r.soc_group, { label: r.label, slug: r.slug })
  return out
}

// Map text wage level (I/II/III/IV/NA) to a 1-4 number for display; null = "all/unknown".
export function wageLevelNumber(level: string | null): number | null {
  switch ((level ?? "").toUpperCase()) {
    case "I": return 1
    case "II": return 2
    case "III": return 3
    case "IV": return 4
    default: return null
  }
}
