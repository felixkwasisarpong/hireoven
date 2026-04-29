"use client"

import { useState } from "react"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core"
import {
  LayoutGrid,
  List,
  Loader2,
  Plus,
} from "lucide-react"
import confetti from "canvas-confetti"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { cn } from "@/lib/utils"
import { useApplications } from "@/lib/hooks/useApplications"
import { ApplicationCard } from "@/components/applications/ApplicationCard"
import { ApplicationDrawer } from "@/components/applications/ApplicationDrawer"
import { AddApplicationModal } from "@/components/applications/AddApplicationModal"
import { ScoutMiniPanel } from "@/components/scout/ScoutMiniPanel"
import type { ApplicationStatus, JobApplication } from "@/types"

// ─── Column config ────────────────────────────────────────────────────────────

type ColumnDef = {
  id: string
  label: string
  statuses: ApplicationStatus[]
  accent: string
  countCls: string
  dropStatus: ApplicationStatus
}

const COLUMNS: ColumnDef[] = [
  { id: "saved",        label: "Saved",     statuses: ["saved"],                   accent: "border-t-slate-400",   countCls: "bg-slate-100 text-slate-600",   dropStatus: "saved" },
  { id: "applied",      label: "Applied",   statuses: ["applied"],                 accent: "border-t-blue-400",    countCls: "bg-blue-50 text-blue-700",      dropStatus: "applied" },
  { id: "phone_screen", label: "Screen",    statuses: ["phone_screen"],            accent: "border-t-amber-400",   countCls: "bg-amber-50 text-amber-700",    dropStatus: "phone_screen" },
  { id: "interview",    label: "Interview", statuses: ["interview"],               accent: "border-t-orange-400",  countCls: "bg-orange-50 text-orange-700",  dropStatus: "interview" },
  { id: "final_round",  label: "Final",     statuses: ["final_round"],             accent: "border-t-indigo-500",  countCls: "bg-indigo-50 text-indigo-700",  dropStatus: "final_round" },
  { id: "offer",        label: "Offer",     statuses: ["offer"],                   accent: "border-t-emerald-500", countCls: "bg-emerald-50 text-emerald-700", dropStatus: "offer" },
  { id: "closed",       label: "Closed",    statuses: ["rejected", "withdrawn"],   accent: "border-t-red-400",     countCls: "bg-red-50 text-red-600",        dropStatus: "rejected" },
]

// ─── Droppable column ─────────────────────────────────────────────────────────

function KanbanColumn({ col, apps, onOpen, isOver }: {
  col: ColumnDef
  apps: JobApplication[]
  onOpen: (app: JobApplication) => void
  isOver: boolean
}) {
  const { setNodeRef } = useDroppable({ id: col.id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-t-[3px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors",
        col.accent,
        isOver ? "border-slate-300 bg-orange-50/30" : "border-slate-200"
      )}
      style={{ minWidth: 188, minHeight: 460 }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3.5 py-3">
        <span className="text-[12px] font-semibold text-slate-700">{col.label}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", col.countCls)}>
          {apps.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        {apps.map((app) => (
          <ApplicationCard key={app.id} application={app} onOpen={() => onOpen(app)} />
        ))}
        {apps.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[11.5px] text-slate-400">Drop here</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Table view ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  saved: "Saved", applied: "Applied", phone_screen: "Screen",
  interview: "Interview", final_round: "Final", offer: "Offer",
  rejected: "Rejected", withdrawn: "Withdrawn",
}
const STATUS_COLOR: Record<ApplicationStatus, string> = {
  saved:        "bg-slate-100 text-slate-600 border-slate-200",
  applied:      "bg-blue-50 text-blue-700 border-blue-200",
  phone_screen: "bg-amber-50 text-amber-700 border-amber-200",
  interview:    "bg-orange-50 text-orange-700 border-orange-200",
  final_round:  "bg-indigo-50 text-indigo-700 border-indigo-200",
  offer:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected:     "bg-red-50 text-red-600 border-red-200",
  withdrawn:    "bg-slate-100 text-slate-500 border-slate-200",
}

function TableView({ apps, onOpen }: { apps: JobApplication[]; onOpen: (a: JobApplication) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <table className="w-full min-w-[600px]">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            <th className="px-4 py-3.5">Company</th>
            <th className="px-4 py-3.5">Role</th>
            <th className="px-4 py-3.5">Status</th>
            <th className="px-4 py-3.5">Applied</th>
            <th className="px-4 py-3.5">Score</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => (
            <tr key={app.id} onClick={() => onOpen(app)} className="cursor-pointer border-b border-slate-100 last:border-0 transition hover:bg-slate-50/70">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <CompanyLogo
                    companyName={app.company_name}
                    domain={app.company_domain ?? undefined}
                    logoUrl={app.company_logo_url}
                    className="h-8 w-8 rounded-lg"
                  />
                  <span className="text-[13px] font-medium text-slate-800">{app.company_name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-[13px] text-slate-800">{app.job_title}</td>
              <td className="px-4 py-3">
                <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", STATUS_COLOR[app.status])}>
                  {STATUS_LABEL[app.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-[12.5px] text-slate-400">
                {app.applied_at ? new Date(app.applied_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
              </td>
              <td className="px-4 py-3 text-[12.5px] text-slate-400">
                {app.match_score != null ? `${app.match_score}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {apps.length === 0 && (
        <div className="py-12 text-center text-sm text-slate-400">No applications found</div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ApplicationsPage() {
  const {
    applications,
    grouped,
    stats,
    isLoading,
    moveApplication,
    addApplication,
    updateApplication,
    deleteApplication,
    addTimelineEntry,
    removeTimelineEntry,
  } = useApplications()

  const [view, setView] = useState<"kanban" | "table">("kanban")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColId, setOverColId] = useState<string | null>(null)
  const [selectedApp, setSelectedApp] = useState<JobApplication | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addDefaultStatus, setAddDefaultStatus] = useState<ApplicationStatus>("saved")

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  function handleDragStart(e: DragStartEvent) {
    setActiveId(e.active.id as string)
  }

  function handleDragOver(e: any) {
    setOverColId(e.over?.id ?? null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    setOverColId(null)
    const { active, over } = e
    if (!over) return

    const targetCol = COLUMNS.find((c) => c.id === over.id)
    if (!targetCol) return

    const app = applications.find((a) => a.id === active.id)
    if (!app || targetCol.statuses.includes(app.status)) return

    if (targetCol.dropStatus === "offer") {
      void confetti({ particleCount: 130, spread: 80, origin: { y: 0.55 } })
    }
    void moveApplication(app.id, targetCol.dropStatus)
  }

  const activeApp = activeId ? applications.find((a) => a.id === activeId) : null
  const currentApp = selectedApp ? (applications.find((a) => a.id === selectedApp.id) ?? selectedApp) : null

  const activeRounds =
    (stats?.by_status.phone_screen ?? 0) +
    (stats?.by_status.interview ?? 0) +
    (stats?.by_status.final_round ?? 0)

  return (
    <main className="app-page !bg-white">
      <div className="app-shell w-full space-y-5 bg-white px-4 pb-10 pt-1 sm:px-6 lg:space-y-6 lg:px-8">

        {/* ── Header ── */}
        <section className="bg-white py-2">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-kicker">Pipeline</p>
              <h1 className="section-title mt-2.5">Applications</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2.5 pt-1">
              <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5">
                {(["kanban", "table"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setView(mode)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-[10px] transition",
                      view === mode
                        ? "bg-slate-800 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-700"
                    )}
                  >
                    {mode === "kanban" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { setAddDefaultStatus("saved"); setShowAddModal(true) }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-orange-400"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
          </div>

          {/* ── Stat strip ── */}
          {stats && (
            <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-slate-100 pt-5">
              {[
                { label: "Tracked",       value: stats.total,                   color: "text-slate-900" },
                { label: "Response rate", value: `${stats.response_rate}%`,     color: "text-slate-900" },
                { label: "Active rounds", value: activeRounds,                  color: "text-slate-900" },
                { label: "Offers",        value: stats.by_status.offer ?? 0,    color: (stats.by_status.offer ?? 0) > 0 ? "text-emerald-600" : "text-slate-900" },
              ].map((s) => (
                <div key={s.label}>
                  <p className={cn("text-[26px] font-bold leading-none tabular-nums", s.color)}>{s.value}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{s.label}</p>
                </div>
              ))}
              {stats.response_rate > 0 && (
                <div className="ml-auto hidden items-center gap-1 xl:flex">
                  {[
                    { label: "App→Screen",  value: stats.conversion_rates.applied_to_phone },
                    { label: "Screen→Int",  value: stats.conversion_rates.phone_to_interview },
                    { label: "Int→Offer",   value: stats.conversion_rates.interview_to_offer },
                  ].map((r) => (
                    <div key={r.label} className="rounded-lg bg-slate-50 px-3 py-2 text-center ring-1 ring-slate-200/60">
                      <p className="text-[14px] font-bold text-slate-800">{r.value}%</p>
                      <p className="mt-0.5 text-[9.5px] text-slate-400">{r.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Loading ── */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
          </div>
        )}

        {/* ── Kanban ── */}
        {!isLoading && view === "kanban" && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="overflow-x-auto pb-2">
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: "repeat(7, minmax(188px, 1fr))", minWidth: 1350 }}
              >
                {COLUMNS.map((col) => (
                  <KanbanColumn
                    key={col.id}
                    col={col}
                    apps={col.statuses.flatMap((s) => grouped[s] ?? [])}
                    onOpen={setSelectedApp}
                    isOver={overColId === col.id}
                  />
                ))}
              </div>
            </div>

            <DragOverlay dropAnimation={{ duration: 180, easing: "ease" }}>
              {activeApp && (
                <div className="rotate-[1.5deg] opacity-95 shadow-2xl">
                  <ApplicationCard application={activeApp} onOpen={() => {}} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}

        {/* ── Table ── */}
        {!isLoading && view === "table" && (
          <div className="overflow-x-auto">
            <TableView apps={applications} onOpen={setSelectedApp} />
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && applications.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50">
              <LayoutGrid className="h-8 w-8 text-orange-500" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No applications yet</p>
            <p className="mt-1 text-sm text-slate-400">Track every application — from saved to offer</p>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-400"
            >
              <Plus className="h-4 w-4" />
              Add first application
            </button>
          </div>
        )}

        {currentApp && (
          <ApplicationDrawer
            application={currentApp}
            onClose={() => setSelectedApp(null)}
            onUpdate={async (updates) => { await updateApplication(currentApp.id, updates) }}
            onDelete={() => { deleteApplication(currentApp.id); setSelectedApp(null) }}
            onAddTimeline={async (entry) => { await addTimelineEntry(currentApp.id, entry) }}
            onRemoveTimeline={(entryId) => removeTimelineEntry(currentApp.id, entryId)}
          />
        )}

        {showAddModal && (
          <AddApplicationModal
            onClose={() => setShowAddModal(false)}
            defaultStatus={addDefaultStatus}
            onAdd={async (payload) => { await addApplication(payload) }}
          />
        )}

        <ScoutMiniPanel
          pagePath="/dashboard/applications"
          applicationId={currentApp?.id}
          suggestionChips={["What needs follow-up?", "Where am I wasting time?"]}
        />
      </div>
    </main>
  )
}
