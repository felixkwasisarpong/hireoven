import { createAdminClient } from '@/lib/supabase/admin'
import { predictH1BApproval } from '@/lib/h1b/predictor'
import type {
  Company,
  H1BPrediction,
  H1BPredictionInput,
  Job,
} from '@/types'

// Shared prediction helpers for the H1B predict API surface.
// These live here (not in a route.ts) because Next.js 14 only allows a
// fixed set of exports from route files (GET, POST, runtime, dynamic, …).
// Exporting additional helpers from a route file is a build-time type
// error, so the single-job and batch routes both import from this module.

export const H1B_PREDICTION_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

export async function predictForJob(
  jobId: string,
  options: { force?: boolean } = {}
): Promise<{ prediction: H1BPrediction | null; cached: boolean }> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('jobs')
    .select('*, company:companies(*)')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) return { prediction: null, cached: false }
  const job = data as Job & { company: Company }

  if (!options.force && job.h1b_prediction && job.h1b_prediction_at) {
    const age = Date.now() - new Date(job.h1b_prediction_at).getTime()
    if (age < H1B_PREDICTION_CACHE_TTL_MS) {
      return { prediction: job.h1b_prediction as H1BPrediction, cached: true }
    }
  }

  const prediction = await runPrediction(job)

  await (supabase.from('jobs') as any)
    .update({
      h1b_prediction: prediction,
      h1b_prediction_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  return { prediction, cached: false }
}

export async function runPrediction(
  job: Job & { company: Company }
): Promise<H1BPrediction> {
  const input: H1BPredictionInput = {
    jobTitle: job.title,
    normalizedTitle: job.normalized_title,
    company: { id: job.company.id, name: job.company.name },
    location: job.location,
    state: null,
    isRemote: job.is_remote,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    seniorityLevel: job.seniority_level,
    employmentType: job.employment_type,
    socCode: null,
    description: job.description,
  }

  return predictH1BApproval(input)
}
