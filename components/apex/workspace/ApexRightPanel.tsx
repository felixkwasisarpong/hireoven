"use client"

import { useRouter } from "next/navigation"
import { Brain, Shield, Target, Layers, ToggleLeft, ToggleRight, ArrowUpRight } from "lucide-react"
import type { ApexSearchProfile } from "@/lib/apex/search-profile"
import type { ApexStrategyBoard } from "@/lib/apex/types"
import { type ApexPermissionState, PERMISSION_LABELS, writePermissions } from "@/lib/apex/permissions"

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  isActive: boolean
  narrative: string
  workspaceModeLabel: string
  searchProfile: ApexSearchProfile | null
  strategyBoard: ApexStrategyBoard | null
  permissions: ApexPermissionState[]
  onPermissionsChange: (next: ApexPermissionState[]) => void
  onOpenMemory?: () => void
  onOpenPermissions?: () => void
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: typeof Brain; label: string }) {
  return (
    <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
      <Icon className="h-3 w-3" />
      {label}
    </p>
  )
}

function StatTile({
  label,
  value,
  accent,
  href,
}: {
  label: string
  value: number | string
  accent: string
  href: string
}) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="group flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-white p-3 text-left shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all hover:border-slate-200 hover:shadow-[0_4px_14px_rgba(15,23,42,0.09)]"
    >
      <div className="flex items-start justify-between">
        <span className={`text-[26px] font-black leading-none tabular-nums ${accent}`}>{value}</span>
        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 text-slate-300 transition-all group-hover:text-slate-400" />
      </div>
      <span className="text-[10.5px] font-medium text-slate-400">{label}</span>
    </button>
  )
}

function MemoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 rounded-lg px-2.5 py-1.5">
      <span className="w-14 flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="flex-1 truncate text-[12px] font-semibold text-slate-700">{value}</span>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function ApexRightPanel({
  isActive,
  narrative,
  workspaceModeLabel,
  searchProfile,
  strategyBoard,
  permissions,
  onPermissionsChange,
  onOpenMemory,
  onOpenPermissions,
}: Props) {
  const savedJobs  = strategyBoard?.snapshot?.savedJobs ?? 0
  const activeApps = strategyBoard?.snapshot?.activeApplications ?? 0

  function togglePermission(index: number) {
    const updated = permissions.map((p, i) =>
      i === index ? { ...p, allowed: !p.allowed, updatedAt: new Date().toISOString() } : p
    )
    onPermissionsChange(updated)
    writePermissions(updated)
  }

  // Build memory rows
  const memoryRows: { label: string; value: string }[] = []
  if (searchProfile?.preferredRoles?.length) {
    memoryRows.push({ label: "Target", value: searchProfile.preferredRoles.slice(0, 2).join(", ") })
  }
  if (searchProfile?.preferredLocations?.length) {
    memoryRows.push({ label: "Location", value: searchProfile.preferredLocations.slice(0, 2).join(", ") })
  }
  if (searchProfile?.sponsorshipPreference && searchProfile.sponsorshipPreference !== "unknown") {
    memoryRows.push({ label: "Visa", value: searchProfile.sponsorshipPreference.replace(/_/g, " ") })
  }
  if (searchProfile?.salaryPreference?.min) {
    memoryRows.push({ label: "Salary", value: `$${(searchProfile.salaryPreference.min / 1000).toFixed(0)}k+` })
  }
  if (searchProfile?.seniorityPreference?.length) {
    memoryRows.push({ label: "Level", value: searchProfile.seniorityPreference.join(", ") })
  }

  const hasMemory = memoryRows.length > 0

  const KEY_PERMS: Array<ApexPermissionState["permission"]> = [
    "autofill_fields",
    "queue_applications",
    "attach_resume",
    "open_external_pages",
    "read_jobs",
    "read_resume",
    "tailor_resume",
    "generate_cover_letter",
    "insert_cover_letter",
  ]
  const sortedPerms = [...permissions].sort(
    (a, b) => KEY_PERMS.indexOf(a.permission) - KEY_PERMS.indexOf(b.permission)
  )

  return (
    <aside className="flex h-full w-[264px] flex-shrink-0 flex-col overflow-y-auto border-l border-slate-200/60 bg-[#FAFAFA]">

      {/* ── At a glance ── */}
      <div className="border-b border-slate-200/60 px-5 py-5">
        <SectionLabel icon={Target} label="At a Glance" />
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Saved Jobs"    value={savedJobs}  accent="text-blue-600"     href="/dashboard/watchlist" />
          <StatTile label="Applications"  value={activeApps} accent="text-emerald-600"  href="/dashboard/applications" />
        </div>
      </div>

      {/* ── Current task — only when active ── */}
      {isActive && (
        <div className="border-b border-slate-200/60 px-5 py-4">
          <SectionLabel icon={Layers} label="Current Task" />
        <div className="flex items-start gap-2">
            <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-blue-600" />
            <p className="text-[12px] leading-5 text-slate-600">{narrative || "Processing…"}</p>
          </div>
          <div className="relative mt-3 h-[2px] overflow-hidden rounded-full bg-slate-100">
            <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-blue-200/0 via-blue-500 to-blue-200/0 animate-[apex-shimmer_1.8s_ease-in-out_infinite]" />
          </div>
          {workspaceModeLabel && workspaceModeLabel !== "Ready" && (
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-600/70">
              {workspaceModeLabel}
            </p>
          )}
        </div>
      )}

      {/* ── Memory ── */}
      <div className="border-b border-slate-200/60 px-5 py-4">
        <div className="flex items-center justify-between">
          <SectionLabel icon={Brain} label="Memory" />
          {hasMemory && onOpenMemory && (
            <button
              type="button"
              onClick={onOpenMemory}
              className="-mt-2.5 text-[10px] font-semibold text-blue-600 transition-opacity hover:opacity-70"
            >
              Manage →
            </button>
          )}
        </div>
        {hasMemory ? (
          <div className="-mx-2 space-y-0.5">
            {memoryRows.map(({ label, value }) => (
              <MemoryRow key={label} label={label} value={value} />
            ))}
          </div>
        ) : (
          <div>
            <div className="mb-3 space-y-1.5">
              {[
                "Target role: Backend Engineer",
                "Preferred: Remote",
                "Visa: H-1B required",
              ].map((ex) => (
                <span
                  key={ex}
                  className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-400"
                >
                  {ex}
                </span>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Apex learns your preferences as you chat.
            </p>
          </div>
        )}
      </div>

      {/* ── Permissions ── */}
      <div className="flex-1 px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel icon={Shield} label="Permissions" />
          {onOpenPermissions && (
            <button
              type="button"
              onClick={onOpenPermissions}
              className="-mt-2.5 text-[10px] font-semibold text-blue-600 transition-opacity hover:opacity-70"
            >
              Manage →
            </button>
          )}
        </div>

        {sortedPerms.length === 0 ? (
          <p className="text-[11px] italic text-slate-400">No permissions configured</p>
        ) : (() => {
          const enabledCount = sortedPerms.filter((p) => p.allowed).length
          const offPerms     = sortedPerms.filter((p) => !p.allowed)
          return (
            <div>
              {/* Enabled counter */}
              <div className="mb-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${(enabledCount / sortedPerms.length) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-slate-600">
                  {enabledCount}<span className="font-normal text-slate-400">/{sortedPerms.length}</span>
                </span>
              </div>

              {offPerms.length > 0 && (
                <div className="space-y-2">
                  {offPerms.slice(0, 3).map((p) => {
                    const meta = PERMISSION_LABELS[p.permission]
                    const permIndex = permissions.findIndex((x) => x.permission === p.permission)
                    return (
                      <div key={p.permission} className="flex items-center justify-between gap-2">
                        <p className="flex-1 truncate text-[11.5px] text-slate-500">
                          {meta?.name ?? p.permission}
                        </p>
                        <button
                          type="button"
                          onClick={() => togglePermission(permIndex)}
                          className="flex-shrink-0 transition-opacity hover:opacity-70"
                          aria-label={`Enable ${meta?.name}`}
                        >
                          {p.allowed
                            ? <ToggleRight className="h-4 w-4 text-emerald-500" />
                            : <ToggleLeft className="h-4 w-4 text-slate-300" />
                          }
                        </button>
                      </div>
                    )
                  })}
                  {offPerms.length > 3 && (
                    <p className="text-[10px] text-slate-400">+{offPerms.length - 3} more off</p>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </aside>
  )
}
