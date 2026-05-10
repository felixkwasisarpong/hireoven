"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { PromoRow } from "@/app/api/admin/promos/route"

const THEMES = ["orange", "blue", "green", "purple"] as const
const ICONS  = ["sparkles", "graduation", "gift", "zap", "star", "rocket"] as const

const THEME_PREVIEW: Record<string, string> = {
  orange: "from-amber-500 to-orange-600",
  blue:   "from-blue-500 to-indigo-600",
  green:  "from-emerald-500 to-teal-600",
  purple: "from-violet-500 to-purple-600",
}

const ICON_LABELS: Record<string, string> = {
  sparkles:   "✨ Sparkles",
  graduation: "🎓 Graduation",
  gift:       "🎁 Gift",
  zap:        "⚡ Zap",
  star:       "⭐ Star",
  rocket:     "🚀 Rocket",
}

const EMPTY_FORM: Omit<PromoRow, "id" | "created_at" | "updated_at"> = {
  title: "",
  subtitle: "",
  description: "",
  badge_label: "Premium",
  is_new: false,
  theme: "orange",
  icon: "sparkles",
  cta_label: "Learn more",
  cta_url: "",
  is_active: false,
  starts_at: null,
  ends_at: null,
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
      active ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-500"
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-slate-400")} />
      {active ? "Active" : "Inactive"}
    </span>
  )
}

export default function AdminPromosPage() {
  const [promos, setPromos] = useState<PromoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PromoRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch("/api/admin/promos")
    if (res.ok) {
      const data = await res.json() as { promos: PromoRow[] }
      setPromos(data.promos)
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  function openCreate() {
    setForm(EMPTY_FORM)
    setEditing(null)
    setCreating(true)
    setError(null)
  }

  function openEdit(p: PromoRow) {
    setForm({
      title: p.title, subtitle: p.subtitle, description: p.description,
      badge_label: p.badge_label, is_new: p.is_new, theme: p.theme, icon: p.icon,
      cta_label: p.cta_label, cta_url: p.cta_url, is_active: p.is_active,
      starts_at: p.starts_at, ends_at: p.ends_at,
    })
    setEditing(p)
    setCreating(false)
    setError(null)
  }

  function closeForm() { setEditing(null); setCreating(false); setError(null) }

  async function save() {
    // Client-side guard — catches stale-closure / empty-field issues before hitting the API
    const requiredFields = { title: form.title, subtitle: form.subtitle, description: form.description, cta_label: form.cta_label, cta_url: form.cta_url }
    const emptyFields = Object.entries(requiredFields).filter(([, v]) => !v.trim()).map(([k]) => k)
    if (emptyFields.length > 0) {
      setError(`Please fill in: ${emptyFields.join(", ")}`)
      return
    }

    setSaving(true)
    setError(null)

    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim(),
      description: form.description.trim(),
      badge_label: form.badge_label.trim() || "Premium",
      is_new: form.is_new,
      theme: form.theme,
      icon: form.icon,
      cta_label: form.cta_label.trim(),
      cta_url: form.cta_url.trim(),
      is_active: form.is_active,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    }

    const url = editing ? `/api/admin/promos/${editing.id}` : "/api/admin/promos"
    const method = editing ? "PATCH" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error ?? "Save failed")
    } else {
      closeForm()
      void load()
    }
    setSaving(false)
  }

  async function toggleActive(p: PromoRow) {
    await fetch(`/api/admin/promos/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !p.is_active }),
    })
    void load()
  }

  async function del(p: PromoRow) {
    if (!confirm(`Delete "${p.title}"?`)) return
    await fetch(`/api/admin/promos/${p.id}`, { method: "DELETE" })
    void load()
  }

  const showForm = editing || creating

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Promo cards</h1>
          <p className="mt-0.5 text-sm text-slate-500">Manage the promotional banner shown in the dashboard sidebar.</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          + New promo
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-[15px] font-semibold text-slate-900">
            {editing ? `Edit "${editing.title}"` : "New promo"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Headline *</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. 40% bonus"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Subtitle *</label>
              <input
                value={form.subtitle}
                onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))}
                placeholder="e.g. University student offer"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Description *</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Body copy shown under the subtitle"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 resize-none"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Badge label</label>
              <input
                value={form.badge_label}
                onChange={e => setForm(f => ({ ...f, badge_label: e.target.value }))}
                placeholder="Premium"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Icon</label>
              <select
                value={form.icon}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white"
              >
                {ICONS.map(i => <option key={i} value={i}>{ICON_LABELS[i]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Theme</label>
              <div className="flex gap-2 mt-1">
                {THEMES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, theme: t }))}
                    className={cn(
                      "h-7 w-7 rounded-full bg-gradient-to-br transition-all ring-2",
                      THEME_PREVIEW[t],
                      form.theme === t ? "ring-slate-700 scale-110" : "ring-transparent hover:scale-105"
                    )}
                    title={t}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">CTA label *</label>
              <input
                value={form.cta_label}
                onChange={e => setForm(f => ({ ...f, cta_label: e.target.value }))}
                placeholder="Claim student pricing"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">CTA URL *</label>
              <input
                value={form.cta_url}
                onChange={e => setForm(f => ({ ...f, cta_url: e.target.value }))}
                placeholder="/dashboard/billing or https://..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Starts at (optional)</label>
              <input
                type="datetime-local"
                value={form.starts_at ? form.starts_at.slice(0, 16) : ""}
                onChange={e => setForm(f => ({ ...f, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Ends at (optional)</label>
              <input
                type="datetime-local"
                value={form.ends_at ? form.ends_at.slice(0, 16) : ""}
                onChange={e => setForm(f => ({ ...f, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div className="flex items-center gap-4 sm:col-span-2">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_new}
                  onChange={e => setForm(f => ({ ...f, is_new: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 accent-orange-500"
                />
                <span className="text-sm text-slate-700">Show "New" badge</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 accent-orange-500"
                />
                <span className="text-sm text-slate-700">Active (show in dashboard)</span>
              </label>
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

          <div className="mt-5 flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60 transition-colors"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create promo"}
            </button>
            <button onClick={closeForm} className="rounded-lg border border-slate-200 px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[0,1,2].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : promos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <p className="text-sm font-semibold text-slate-600">No promos yet</p>
          <p className="mt-1 text-sm text-slate-400">Create one to start showing it in the dashboard.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {promos.map(p => (
            <div key={p.id} className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4">
              {/* Theme swatch */}
              <div className={cn("mt-0.5 h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br", THEME_PREVIEW[p.theme] ?? THEME_PREVIEW.orange)} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-[15px] font-bold text-slate-900">{p.title}</span>
                  <StatusBadge active={p.is_active} />
                  {p.is_new && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">New</span>}
                </div>
                <p className="text-[13px] font-medium text-slate-700">{p.subtitle}</p>
                <p className="text-[12px] text-slate-500 mt-0.5 line-clamp-1">{p.description}</p>
                <div className="mt-1 text-[11px] text-slate-400 flex flex-wrap gap-3">
                  <span>CTA: {p.cta_label} → {p.cta_url}</span>
                  {p.starts_at && <span>Starts {new Date(p.starts_at).toLocaleDateString()}</span>}
                  {p.ends_at && <span>Ends {new Date(p.ends_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => toggleActive(p)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
                    p.is_active
                      ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  )}
                >
                  {p.is_active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => openEdit(p)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Edit
                </button>
                <button onClick={() => del(p)} className="rounded-lg border border-red-100 px-3 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-50 transition-colors">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
