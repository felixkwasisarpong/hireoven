import SetupForm from "@/components/interview/SetupForm"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { creditsForDuration, getBalance } from "@/lib/scout/interview/credits"

export const dynamic = "force-dynamic"

type InterviewType = "text" | "live" | "coding"
const VALID_TYPES: InterviewType[] = ["text", "live", "coding"]

type SearchParams = Record<string, string | string[] | undefined>

type SetupJob = {
  id: string
  job_id: string | null
  job_title: string
  company_name: string
  status: string
}

type SetupInitialData = {
  initialJobs: SetupJob[]
  initialJobsLoaded: boolean
  initialCredits: { balance: number; costs: { short: number } } | null
  initialCreditsLoaded: boolean
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

async function fetchSetupJobs(userId: string): Promise<SetupJob[]> {
  const pool = getPostgresPool()
  const result = await pool.query<SetupJob>(
    `SELECT id, job_id, job_title, company_name, status
     FROM job_applications
     WHERE user_id = $1::uuid
       AND is_archived = false
       AND job_id IS NOT NULL
       AND status NOT IN ('rejected', 'withdrawn')
     ORDER BY updated_at DESC
     LIMIT 500`,
    [userId],
  )

  return result.rows
}

async function getSetupInitialData(
  userId: string | null,
  initialType: InterviewType | undefined,
): Promise<SetupInitialData> {
  const fallback: SetupInitialData = {
    initialJobs: [],
    initialJobsLoaded: false,
    initialCredits: null,
    initialCreditsLoaded: false,
  }

  if (!userId) {
    return {
      initialJobs: [],
      initialJobsLoaded: true,
      initialCredits: null,
      initialCreditsLoaded: false,
    }
  }

  try {
    const [jobsResult, creditsResult] = await Promise.allSettled([
      fetchSetupJobs(userId),
      initialType === "live"
        ? (async () => {
            const plan = await getPlanForUserId(userId)
            const { balance } = await getBalance(userId, plan)
            return {
              balance,
              costs: { short: creditsForDuration(30) },
            }
          })()
        : Promise.resolve(null),
    ])

    return {
      initialJobs: jobsResult.status === "fulfilled" ? jobsResult.value : fallback.initialJobs,
      initialJobsLoaded: jobsResult.status === "fulfilled",
      initialCredits: creditsResult.status === "fulfilled" ? creditsResult.value : null,
      initialCreditsLoaded: creditsResult.status === "fulfilled",
    }
  } catch {
    return fallback
  }
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const rawType = firstValue(params.type)
  const initialType = VALID_TYPES.includes(rawType as InterviewType)
    ? (rawType as InterviewType)
    : undefined
  const initialJobId = firstValue(params.jobId)

  const sessionUser = await getSessionUser()
  const initialData = await getSetupInitialData(sessionUser?.sub ?? null, initialType)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <SetupForm
        initialType={initialType}
        initialJobId={initialJobId}
        initialJobs={initialData.initialJobs}
        initialJobsLoaded={initialData.initialJobsLoaded}
        initialCredits={initialData.initialCredits}
        initialCreditsLoaded={initialData.initialCreditsLoaded}
      />
    </div>
  )
}
