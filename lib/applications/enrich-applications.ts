import type { SupabaseClient } from "@supabase/supabase-js"
import { domainFromApplyUrl } from "@/lib/applications/company-domain"

/** Attach `company_domain` for CompanyLogo fallbacks (from jobs → companies, else apply URL). */
export async function enrichJobApplicationsWithDomain(
  supabase: SupabaseClient<any, "public", any>,
  apps: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (apps.length === 0) return apps

  const jobIds = [...new Set(apps.map((a) => a.job_id).filter(Boolean))] as string[]
  const domainByJobId = new Map<string, string>()

  if (jobIds.length > 0) {
    const { data: jobRows } = await supabase
      .from("jobs")
      .select("id, company:companies(domain)")
      .in("id", jobIds)

    for (const row of jobRows ?? []) {
      const r = row as { id: string; company?: { domain?: string | null } }
      const d = r.company?.domain?.trim()
      if (d) domainByJobId.set(r.id, d)
    }
  }

  return apps.map((a) => {
    const jobId = a.job_id as string | null
    const fromJob = jobId ? domainByJobId.get(jobId) : null
    const fromApply = domainFromApplyUrl(a.apply_url as string | null)
    return {
      ...a,
      company_domain: fromJob ?? fromApply ?? null,
    }
  })
}
