"use client"

import { useState } from "react"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  BarChart2,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
} from "lucide-react"
import Link from "next/link"
import confetti from "canvas-confetti"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { cn } from "@/lib/utils"
import { useApplications } from "@/lib/hooks/useApplications"
import { ApplicationCard } from "@/components/applications/ApplicationCard"
import { ApplicationDrawer } from "@/components/applications/ApplicationDrawer"
import { AddApplicationModal } from "@/components/applications/AddApplicationModal"
import { PipelineStatsPanel } from "@/components/applications/PipelineStats"
import type { ApplicationStatus, JobApplication } from "@/types"

// ─── Column config ────────────────────────────────────────────────────────────

type ColumnDef = {
  id: string
  label: string
  statuses: ApplicationStatus[]
  accentClass: string
  countClass: string
  dropStatus: ApplicationStatus
}

const COLUMNS: ColumnDef[] = [
  { id: "saved", label: "Saved", statuses: ["saved"], accentClass: "border-t-slate-400", countClass: "bg-slate-100 text-slate-600", dropStatus: "saved" },
  { id: "applied", label: "Applied", statuses: ["applied"], accentClass: "border-t-blue-400", countClass: "bg-blue-50 text-blue-700", dropStatus: "applied" },
  { id: "phone_screen", label: "Screen", statuses: ["phone_screen"], accentClass: "border-t-amber-400", countClass: "bg-amber-50 text-amber-700", dropStatus: "phone_screen" },
  { id: "interview", label: "Interview", statuses: ["interview"], accentClass: "border-t-violet-400", countClass: "bg-violet-50 text-violet-700", dropStatus: "interview" },
  { id: "final_round", label: "Final", statuses: ["final_round"], accentClass: "border-t-indigo-500", countClass: "bg-indigo-50 text-indigo-700", dropStatus: "final_round" },
  { id: "offer", label: "Offer", statuses: ["offer"], accentClass: "border-t-emerald-500", countClass: "bg-emerald-50 text-emerald-700", dropStatus: "offer" },
  { id: "closed", label: "Closed", statuses: ["rejected", "withdrawn"], accentClass: "border-t-red-400", countClass: "bg-red-50 text-red-600", dropStatus: "rejected" },
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
        "flex min-w-[188px] flex-col overflow-hidden rounded-2xl border border-border border-t-[3px] bg-surface-alt/80 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition",
        col.accentClass,
        isOver && "bg-brand-tint/40 ring-2 ring-primary/25"
      )}
      style={{ minHeight: 420 }}
    >
      <div className="flex items-center justify-between border-b border-border/60 px-3.5 py-3">
        <span className="text-[12px] font-semibold text-strong">{col.label}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", col.countClass)}>
          {apps.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-2.5 pb-3">
        <SortableContext items={apps.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          {apps.map((app) => (
            <ApplicationCard key={app.id} application={app} onOpen={() => onOpen(app)} />
          ))}
        </SortableContext>
        {apps.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[11.5px] text-muted-foreground">Drop here</p>
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
  saved: "bg-slate-100 text-slate-600 border-slate-200",
  applied: "bg-blue-50 text-blue-700 border-blue-200",
  phone_screen: "bg-amber-50 text-amber-700 border-amber-200",
  interview: "bg-violet-50 text-violet-700 border-violet-200",
  final_round: "bg-indigo-50 text-indigo-700 border-indigo-200",
  offer: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-600 border-red-200",
  withdrawn: "bg-slate-100 text-slate-500 border-slate-200",
}

function TableView({ apps, onOpen }: { apps: JobApplication[]; onOpen: (a: JobApplication) => void }) {
  return (
    <div className="surface-panel overflow-hidden rounded-xl shadow-[0_6px_18px_rgba(15,23,42,0.05)]">
      <table className="w-full min-w-[600px]">
        <thead>
          <tr className="border-b border-border bg-surface-alt/50 text-left text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <th className="px-4 py-3.5">Company</th>
            <th className="px-4 py-3.5">Role</th>
            <th className="px-4 py-3.5">Status</th>
            <th className="px-4 py-3.5">Applied</th>
            <th className="px-4 py-3.5">Score</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => (
            <tr key={app.id} onClick={() => onOpen(app)} className="group cursor-pointer border-b border-border/80 last:border-0 transition hover:bg-surface-alt/80">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <CompanyLogo
                    companyName={app.company_name}
                    domain={app.company_domain ?? undefined}
                    logoUrl={app.company_logo_url}
                    className="h-8 w-8 rounded-lg"
                  />
                  <span className="text-[13px] font-medium text-strong">{app.company_name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-[13px] text-strong">{app.job_title}</td>
              <td className="px-4 py-3">
                <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", STATUS_COLOR[app.status])}>
                  {STATUS_LABEL[app.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-[12.5px] text-muted-foreground">
                {app.applied_at ? new Date(app.applied_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
              </td>
              <td className="px-4 py-3 text-[12.5px] text-muted-foreground">
                {app.match_score != null ? `${app.match_score}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {apps.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">No applications found</div>
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
  const [statsOpen, setStatsOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColId, setOverColId] = useState<string | null>(null)
  const [selectedApp, setSelectedApp] = useState<JobApplication | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addDefaultStatus, setAddDefaultStatus] = useState<ApplicationStatus>("saved")

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function getColApps(col: ColumnDef) {
    const all = col.statuses.flatMap((s) => grouped[s] ?? [])
    if (!search.trim()) return all
    return all.filter((a) =>
      `${a.company_name} ${a.job_title}`.toLowerCase().includes(search.toLowerCase())
    )
  }

  const filteredApps = search.trim()
    ? applications.filter((a) =>
        `${a.company_name} ${a.job_title}`.toLowerCase().includes(search.toLowerCase())
      )
    : applications

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

  return (
    <main className="app-page">
      <div className="app-shell max-w-[1680px] space-y-6 px-4 pb-10 pt-1 sm:px-6 lg:space-y-8 lg:px-8">
        <section className="surface-hero rounded-xl border border-border p-5 sm:p-6 md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="section-kicker">Pipeline</p>
              <h1 className="section-title mt-2.5">Applications</h1>
              <p className="section-copy mt-2.5 max-w-2xl">
                Drag cards between stages, search everything, or switch to table view — one place for your search.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              <Link
                href="/dashboard/applications/insights"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[13px] font-semibold text-muted-foreground transition hover:border-border hover:bg-surface-alt hover:text-strong"
              >
                <BarChart2 className="h-4 w-4" />
                Insights
              </Link>
              <button
                type="button"
                onClick={() => {
                  setAddDefaultStatus("saved")
                  setShowAddModal(true)
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition hover:bg-primary-hover"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
          </div>
        </section>

        <section className="surface-panel rounded-xl border border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search companies or roles…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-strong placeholder:text-muted-foreground shadow-[0_1px_0_rgba(15,23,42,0.04)] focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
              />
            </div>

            <div className="flex items-center rounded-xl border border-border bg-surface-alt p-0.5">
              {(["kanban", "table"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-[10px] transition",
                    view === mode
                      ? "bg-brand-navy text-white shadow-sm"
                      : "text-muted-foreground hover:text-strong"
                  )}
                >
                  {mode === "kanban" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
                </button>
              ))}
            </div>

            {stats && (
              <button
                type="button"
                onClick={() => setStatsOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[13px] font-semibold text-muted-foreground transition hover:bg-surface-alt"
              >
                Stats
                {statsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </section>

      {statsOpen && stats && (
        <div className="animate-fade-in">
          <PipelineStatsPanel stats={stats} />
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Kanban */}
      {!isLoading && view === "kanban" && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="overflow-x-auto pb-2">
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(7, minmax(188px, 1fr))", minWidth: 1350 }}>
              {COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.id}
                  col={col}
                  apps={getColApps(col)}
                  onOpen={setSelectedApp}
                  isOver={overColId === col.id}
                />
              ))}
            </div>
          </div>

          <DragOverlay>
            {activeApp && (
              <div className="rotate-[1.5deg] opacity-90 shadow-2xl">
                <ApplicationCard application={activeApp} onOpen={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Table */}
      {!isLoading && view === "table" && (
        <div className="overflow-x-auto">
          <TableView apps={filteredApps} onOpen={setSelectedApp} />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && applications.length === 0 && (
        <div className="empty-state rounded-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-tint">
            <LayoutGrid className="h-8 w-8 text-primary" />
          </div>
          <p className="mt-4 font-semibold text-strong">No applications yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Track every application — from saved to offer
          </p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
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
          onAdd={async (payload) => {
            await addApplication(payload)
          }}
        />
      )}
      </div>
    </main>
  )
}
