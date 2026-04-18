"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Briefcase, CalendarDays, ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type ApplicationItem = {
  id: string
  job_id: string | null
  company_name: string
  job_title: string
  status: string
  apply_url: string | null
  applied_at: string | null
  created_at: string
}

function statusTone(status: string) {
  if (status === "offer") return "bg-emerald-100 text-emerald-700"
  if (status === "interview" || status === "phone_screen") return "bg-sky-100 text-sky-700"
  if (status === "rejected" || status === "withdrawn") return "bg-red-100 text-red-700"
  return "bg-gray-100 text-gray-700"
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<ApplicationItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/applications")
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) {
          setApplications(data.applications ?? [])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const total = applications.length
    const active = applications.filter((application) =>
      ["applied", "phone_screen", "interview", "offer"].includes(application.status)
    ).length
    const interviews = applications.filter((application) =>
      ["phone_screen", "interview", "offer"].includes(application.status)
    ).length
    return { total, active, interviews }
  }, [applications])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Application tracker</h1>
            <p className="mt-1 text-sm text-gray-500">
              Every job you have logged through autofill, in one place.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/dashboard/autofill/history">View autofill history</Link>
          </Button>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total applications", value: stats.total },
            { label: "Active pipelines", value: stats.active },
            { label: "Interviewing", value: stats.interviews },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
            </div>
          ) : applications.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <Briefcase className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">No applications logged yet</h2>
              <p className="mt-1 max-w-md text-sm text-gray-500">
                Once you run autofill and confirm you submitted an application, it will show up here.
              </p>
              <Button asChild className="mt-4 bg-sky-600 text-white hover:bg-sky-700">
                <Link href="/dashboard">Find jobs</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {applications.map((application) => {
                const timestamp = application.applied_at ?? application.created_at
                return (
                  <div
                    key={application.id}
                    className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-gray-900">
                          {application.job_title}
                        </h2>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusTone(application.status)}`}
                        >
                          {application.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{application.company_name}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <div className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {new Date(timestamp).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>

                      {application.job_id && (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/jobs/${application.job_id}`}>View job</Link>
                        </Button>
                      )}

                      {application.apply_url && (
                        <Button asChild size="sm" className="bg-sky-600 text-white hover:bg-sky-700">
                          <a href={application.apply_url} target="_blank" rel="noopener noreferrer">
                            Reopen application
                            <ExternalLink className="ml-2 h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
