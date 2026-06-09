"use client"

import { useEffect, useMemo, useState } from "react"
import { ExternalLink, Linkedin, Loader2, Mail, Users } from "lucide-react"
import type { NetworkingContact, NetworkingContactType } from "@/lib/networking/job-contact-finder"
import { cn } from "@/lib/utils"

type Props = {
  jobId: string
  companyName: string | null
}

type NetworkingApiResponse = {
  contacts: NetworkingContact[]
}

const TYPE_META: Record<NetworkingContactType, { label: string; tone: string }> = {
  alumni: {
    label: "Alumni",
    tone: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  recruiter: {
    label: "Recruiter",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  second_degree: {
    label: "2nd-degree",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
  },
}

const CONFIDENCE_META: Record<NetworkingContact["confidence"], string> = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-slate-50 text-slate-600 ring-slate-200",
}

function groupContacts(contacts: NetworkingContact[]) {
  const grouped: Record<NetworkingContactType, NetworkingContact[]> = {
    alumni: [],
    recruiter: [],
    second_degree: [],
  }
  for (const contact of contacts) grouped[contact.type].push(contact)
  return grouped
}

export default function JobNetworkingContacts({ jobId, companyName }: Props) {
  const [contacts, setContacts] = useState<NetworkingContact[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetch(`/api/jobs/${jobId}/networking`, { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("networking_fetch_failed")
        return (await response.json()) as NetworkingApiResponse
      })
      .then((payload) => {
        if (cancelled) return
        setContacts(Array.isArray(payload.contacts) ? payload.contacts : [])
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        setContacts([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [jobId])

  const grouped = useMemo(() => groupContacts(contacts), [contacts])
  const hasContacts = contacts.length > 0

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        <p className="text-[12px] font-semibold text-slate-900">
          Warm contacts for {companyName ?? "this role"}
        </p>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Prioritized from alumni, recruiter pipeline, and shared-cohort connections.
      </p>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12px] text-slate-500 ring-1 ring-slate-200/70">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Finding likely contacts...
        </div>
      ) : failed ? (
        <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-700 ring-1 ring-rose-200">
          Could not load networking contacts right now.
        </p>
      ) : !hasContacts ? (
        <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-slate-200/70">
          <p className="text-[12.5px] font-semibold text-slate-700">No warm contacts surfaced yet</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            We look for people in your network who can get your application a second look{companyName ? ` at ${companyName}` : ""}:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(Object.keys(TYPE_META) as NetworkingContactType[]).map((type) => (
              <span key={type} className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", TYPE_META[type].tone)}>
                {TYPE_META[type].label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-slate-400">
            Connect LinkedIn in Settings so we can scan your 1st- and 2nd-degree network for intros.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {(Object.keys(TYPE_META) as NetworkingContactType[]).map((type) => {
            const items = grouped[type]
            if (!items.length) return null
            return (
              <div key={type} className="space-y-2">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", TYPE_META[type].tone)}>
                  {TYPE_META[type].label}
                </span>
                <ul className="space-y-2">
                  {items.map((contact) => (
                    <li
                      key={contact.id}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_1px_rgba(15,23,42,0.02)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-semibold text-slate-900">{contact.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">
                            {[contact.role, contact.team, contact.company].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1", CONFIDENCE_META[contact.confidence])}>
                          {contact.confidence}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{contact.reason}</p>
                      <div className="mt-2 flex items-center gap-2">
                        {contact.linkedinUrl ? (
                          <a
                            href={contact.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            <Linkedin className="h-3 w-3" aria-hidden />
                            LinkedIn
                            <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                          </a>
                        ) : null}
                        {contact.email ? (
                          <a
                            href={`mailto:${contact.email}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            <Mail className="h-3 w-3" aria-hidden />
                            Email
                          </a>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
