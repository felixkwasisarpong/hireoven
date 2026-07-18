/**
 * Small presentation helpers for public job rows. Shared by the SEO landing
 * pages (jobs/browse) so the row markup and labels stay consistent with the
 * per-company pages.
 */

export interface PublicJobRow {
  id: string
  title: string
  location: string | null
  is_remote: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  first_detected_at: string | null
  company_name?: string | null
  company_domain?: string | null
  company_logo_url?: string | null
}

/** "$120k–$160k" style label, or null when no salary is known. */
export function salaryLabel(j: Pick<PublicJobRow, "salary_min" | "salary_max" | "salary_currency">): string | null {
  if (j.salary_min == null && j.salary_max == null) return null
  const sym = !j.salary_currency || j.salary_currency === "USD" ? "$" : ""
  const k = (n: number) => `${sym}${Math.round(n / 1000)}k`
  if (j.salary_min && j.salary_max) return `${k(j.salary_min)}–${k(j.salary_max)}`
  return k((j.salary_min ?? j.salary_max) as number)
}

/** Human "how fresh" label from an ISO timestamp. */
export function freshnessLabel(iso: string | null): string {
  if (!iso) return ""
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}
