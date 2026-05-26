import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type { AlertFrequency, Company, JobAlert } from "@/types"
import AlertsPageClient from "./AlertsPageClient"

export const dynamic = "force-dynamic"

type ProfileAlertFrequencyRow = {
  alert_frequency: AlertFrequency | null
}

type AlertsInitialData = {
  initialAlerts: JobAlert[]
  initialAlertsLoaded: boolean
  initialCompanies: Company[]
  initialCompaniesLoaded: boolean
  initialAlertFrequency: AlertFrequency
}

async function fetchInitialAlerts(userId: string): Promise<JobAlert[]> {
  const pool = getPostgresPool()
  const result = await pool.query<JobAlert>(
    `SELECT *
     FROM job_alerts
     WHERE user_id = $1::uuid
     ORDER BY created_at DESC`,
    [userId],
  )
  return result.rows
}

async function fetchInitialCompanies(): Promise<Company[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Company>(
    `SELECT companies.*
     FROM companies
     WHERE companies.is_active = true
     ORDER BY companies.job_count DESC NULLS LAST
     LIMIT 50`,
    [],
  )
  return result.rows
}

async function fetchInitialAlertFrequency(userId: string): Promise<AlertFrequency> {
  const pool = getPostgresPool()
  const result = await pool.query<ProfileAlertFrequencyRow>(
    `SELECT alert_frequency
     FROM profiles
     WHERE id = $1::uuid
     LIMIT 1`,
    [userId],
  )
  const frequency = result.rows[0]?.alert_frequency
  return frequency === "daily" || frequency === "weekly" ? frequency : "instant"
}

async function getAlertsInitialData(userId: string | null): Promise<AlertsInitialData> {
  const fallback: AlertsInitialData = {
    initialAlerts: [],
    initialAlertsLoaded: false,
    initialCompanies: [],
    initialCompaniesLoaded: false,
    initialAlertFrequency: "instant",
  }

  try {
    if (!userId) {
      const companies = await fetchInitialCompanies()
      return {
        initialAlerts: [],
        initialAlertsLoaded: true,
        initialCompanies: companies,
        initialCompaniesLoaded: true,
        initialAlertFrequency: "instant",
      }
    }

    const [alertsResult, companiesResult, frequencyResult] = await Promise.allSettled([
      fetchInitialAlerts(userId),
      fetchInitialCompanies(),
      fetchInitialAlertFrequency(userId),
    ])

    return {
      initialAlerts: alertsResult.status === "fulfilled" ? alertsResult.value : [],
      initialAlertsLoaded: alertsResult.status === "fulfilled",
      initialCompanies: companiesResult.status === "fulfilled" ? companiesResult.value : [],
      initialCompaniesLoaded: companiesResult.status === "fulfilled",
      initialAlertFrequency: frequencyResult.status === "fulfilled" ? frequencyResult.value : "instant",
    }
  } catch {
    return fallback
  }
}

export default async function AlertsPage() {
  const sessionUser = await getSessionUser()
  const initialData = await getAlertsInitialData(sessionUser?.sub ?? null)

  return (
    <AlertsPageClient
      initialAlerts={initialData.initialAlerts}
      initialAlertsLoaded={initialData.initialAlertsLoaded}
      initialCompanies={initialData.initialCompanies}
      initialCompaniesLoaded={initialData.initialCompaniesLoaded}
      initialAlertFrequency={initialData.initialAlertFrequency}
    />
  )
}
