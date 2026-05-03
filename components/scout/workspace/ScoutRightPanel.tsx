"use client"

import { useRouter } from "next/navigation"
import { Brain, Shield, Target, Layers, ToggleLeft, ToggleRight, ArrowRight } from "lucide-react"
import type { ScoutSearchProfile } from "@/lib/scout/search-profile"
import type { ScoutStrategyBoard } from "@/lib/scout/types"
import { type ScoutPermissionState, PERMISSION_LABELS, writePermissions } from "@/lib/scout/permissions"

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  isActive: boolean
  narrative: string
  workspaceModeLabel: string
  searchProfile: ScoutSearchProfile | null
  strategyBoard: ScoutStrategyBoard | null
  permissions: ScoutPermissionState[]
  onPermissionsChange: (next: ScoutPermissionState[]) => void
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: typeof Brain; label: string }) {
  return (
    <p className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
      <Icon className="h-3 w-3" />
      {label}
    </p>
  )
}

// Clickable stat tile with navigation
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
      className="group flex flex-col gap-1 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-left transition-all hover:border-slate-200 hover:bg-white hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className={`text-[22px] font-black leading-none tabular-nums ${accent}`}>{value}</span>
        <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400" />
      </div>
      <span className="text-[10px] text-slate-400">{label}</span>
    </button>
  )
}

// Example memory chip for empty state
function ExampleChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
      {label}
    </span>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function ScoutRightPanel({
  isActive,
  narrative,
  workspaceModeLabel,
  searchProfile,
  strategyBoard,
  permissions,
  onPermissionsChange,
}: Props) {
  const savedJobs = strategyBoard?.snapshot?.savedJobs ?? 0
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

  // Show all permissions, sorted: key ones first
  const KEY_PERMS: Array<ScoutPermissionState["permission"]> = [
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
    <aside className="flex h-full w-[264px] flex-shrink-0 flex-col overflow-y-auto border-l border-slate-100 bg-white">

      {/* ── At a glance ── */}
      <div className="border-b border-slate-100 px-4 py-4">
        <SectionLabel icon={Target} label="At a Glance" />
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Saved Jobs"    value={savedJobs}  accent="text-[#FF5C18]"  href="/dashboard/watchlist" />
          <StatTile label="Applications"  value={activeApps} accent="text-emerald-600" href="/dashboard/applications" />
        </div>
      </div>

      {/* ── Current task ── */}
      <div className="border-b border-slate-100 px-4 py-3.5">
        <SectionLabel icon={Layers} label="Current Task" />
        {isActive ? (
          <div>
            <div className="flex items-start gap-2">
              <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-[#FF5C18]" />
              <p className="text-[12px] leading-5 text-slate-600">{narrative || "Processing…"}</p>
            </div>
            <div className="relative mt-2.5 h-[3px] overflow-hidden rounded-full bg-slate-100">
              <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-orange-200/0 via-[#FF5C18] to-orange-200/0 animate-[scout-shimmer_1.8s_ease-in-out_infinite]" />
            </div>
            {workspaceModeLabel && workspaceModeLabel !== "Ready" && (
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#FF5C18]/60">
                {workspaceModeLabel}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-slate-400">Scout is ready.</p>
        )}
      </div>

      {/* ── Memory ── */}
      <div className="border-b border-slate-100 px-4 py-3.5">
        <SectionLabel icon={Brain} label="Memory" />
        {hasMemory ? (
          <>
            <div className="space-y-2">
              {memoryRows.map(({ label, value }) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="w-14 flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {label}
                  </span>
                  <span className="flex-1 truncate text-[11.5px] font-medium text-slate-700">{value}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2.5 text-[10px] font-medium text-[#FF5C18] hover:underline"
            >
              Manage memory →
            </button>
          </>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <ExampleChip label="Target role: Backend Engineer" />
              <ExampleChip label="Preferred: Remote" />
              <ExampleChip label="Visa: H-1B required" />
            </div>
            <p className="text-[11px] leading-4 text-slate-400">
              Scout learns your preferences as you chat. Start by asking anything.
            </p>
          </div>
        )}
      </div>

      {/* ── Permissions ── */}
      <div className="flex-1 px-4 py-3.5">
        <SectionLabel icon={Shield} label="Permissions" />
        {sortedPerms.length === 0 ? (
          <p className="text-[11px] italic text-slate-400">No permissions configured</p>
        ) : (
          <div className="space-y-2.5">
            {sortedPerms.map((p) => {
              const meta = PERMISSION_LABELS[p.permission]
              const permIndex = permissions.findIndex((x) => x.permission === p.permission)
              return (
                <div key={p.permission} className="flex items-center justify-between gap-2">
                  <p className="flex-1 truncate text-[11px] text-slate-600">
                    {meta?.name ?? p.permission}
                  </p>
                  <button
                    type="button"
                    onClick={() => togglePermission(permIndex)}
                    className="flex-shrink-0 transition-opacity hover:opacity-70"
                    aria-label={p.allowed ? `Disable ${meta?.name}` : `Enable ${meta?.name}`}
                  >
                    {p.allowed
                      ? <ToggleRight className="h-4 w-4 text-[#FF5C18]" />
                      : <ToggleLeft  className="h-4 w-4 text-slate-300" />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
