"use client"

import { useEffect, useState } from "react"
import type { TestimonialRow, PartnerRow } from "@/lib/marketing/social-proof-store"

function PublishPill({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-400"}`} />
      {on ? "Published" : "Hidden"}
    </span>
  )
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
const labelCls = "text-[12px] font-medium text-slate-500"

type TestimonialForm = {
  quote: string
  name: string
  role: string
  org: string
  avatar_url: string
  is_published: boolean
  sort_order: number
}
const EMPTY_TESTIMONIAL: TestimonialForm = {
  quote: "",
  name: "",
  role: "",
  org: "",
  avatar_url: "",
  is_published: false,
  sort_order: 0,
}

type PartnerForm = {
  name: string
  logo_url: string
  url: string
  is_published: boolean
  sort_order: number
}
const EMPTY_PARTNER: PartnerForm = { name: "", logo_url: "", url: "", is_published: false, sort_order: 0 }

export default function AdminSocialProofPage() {
  const [testimonials, setTestimonials] = useState<TestimonialRow[]>([])
  const [partners, setPartners] = useState<PartnerRow[]>([])
  const [loading, setLoading] = useState(true)

  // testimonial editor
  const [tForm, setTForm] = useState<TestimonialForm>(EMPTY_TESTIMONIAL)
  const [tEditingId, setTEditingId] = useState<string | null>(null)
  const [tOpen, setTOpen] = useState(false)
  const [tError, setTError] = useState<string | null>(null)

  // partner editor
  const [pForm, setPForm] = useState<PartnerForm>(EMPTY_PARTNER)
  const [pEditingId, setPEditingId] = useState<string | null>(null)
  const [pOpen, setPOpen] = useState(false)
  const [pError, setPError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [t, p] = await Promise.all([
      fetch("/api/admin/testimonials").then((r) => (r.ok ? r.json() : { testimonials: [] })),
      fetch("/api/admin/partners").then((r) => (r.ok ? r.json() : { partners: [] })),
    ])
    setTestimonials(t.testimonials ?? [])
    setPartners(p.partners ?? [])
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])

  // ── Testimonials ──
  function openNewTestimonial() {
    setTForm(EMPTY_TESTIMONIAL)
    setTEditingId(null)
    setTOpen(true)
    setTError(null)
  }
  function openEditTestimonial(t: TestimonialRow) {
    setTForm({
      quote: t.quote,
      name: t.name,
      role: t.role,
      org: t.org ?? "",
      avatar_url: t.avatar_url ?? "",
      is_published: t.is_published,
      sort_order: t.sort_order,
    })
    setTEditingId(t.id)
    setTOpen(true)
    setTError(null)
  }
  async function saveTestimonial() {
    const missing = (["quote", "name", "role"] as const).filter((k) => !tForm[k].trim())
    if (missing.length) {
      setTError(`Please fill in: ${missing.join(", ")}`)
      return
    }
    const payload = {
      quote: tForm.quote.trim(),
      name: tForm.name.trim(),
      role: tForm.role.trim(),
      org: tForm.org.trim() || null,
      avatar_url: tForm.avatar_url.trim() || null,
      is_published: tForm.is_published,
      sort_order: Number(tForm.sort_order) || 0,
    }
    const url = tEditingId ? `/api/admin/testimonials/${tEditingId}` : "/api/admin/testimonials"
    const res = await fetch(url, {
      method: tEditingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      setTError(d.error ?? "Save failed")
      return
    }
    setTOpen(false)
    void load()
  }
  async function toggleTestimonial(t: TestimonialRow) {
    await fetch(`/api/admin/testimonials/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: !t.is_published }),
    })
    void load()
  }
  async function deleteTestimonial(t: TestimonialRow) {
    if (!confirm(`Delete testimonial from "${t.name}"?`)) return
    await fetch(`/api/admin/testimonials/${t.id}`, { method: "DELETE" })
    void load()
  }

  // ── Partners ──
  function openNewPartner() {
    setPForm(EMPTY_PARTNER)
    setPEditingId(null)
    setPOpen(true)
    setPError(null)
  }
  function openEditPartner(p: PartnerRow) {
    setPForm({
      name: p.name,
      logo_url: p.logo_url ?? "",
      url: p.url ?? "",
      is_published: p.is_published,
      sort_order: p.sort_order,
    })
    setPEditingId(p.id)
    setPOpen(true)
    setPError(null)
  }
  async function savePartner() {
    if (!pForm.name.trim()) {
      setPError("Please fill in: name")
      return
    }
    const payload = {
      name: pForm.name.trim(),
      logo_url: pForm.logo_url.trim() || null,
      url: pForm.url.trim() || null,
      is_published: pForm.is_published,
      sort_order: Number(pForm.sort_order) || 0,
    }
    const url = pEditingId ? `/api/admin/partners/${pEditingId}` : "/api/admin/partners"
    const res = await fetch(url, {
      method: pEditingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      setPError(d.error ?? "Save failed")
      return
    }
    setPOpen(false)
    void load()
  }
  async function togglePartner(p: PartnerRow) {
    await fetch(`/api/admin/partners/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: !p.is_published }),
    })
    void load()
  }
  async function deletePartner(p: PartnerRow) {
    if (!confirm(`Delete partner "${p.name}"?`)) return
    await fetch(`/api/admin/partners/${p.id}`, { method: "DELETE" })
    void load()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Social proof</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Testimonials and partner logos shown on the public{" "}
          <a href="/partners" className="text-emerald-700 underline">
            /partners
          </a>{" "}
          page. Only published items appear.
        </p>
      </div>

      {/* Testimonials */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-slate-900">Testimonials</h2>
          <button
            onClick={openNewTestimonial}
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            + New testimonial
          </button>
        </div>

        {tOpen && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Quote *</label>
                <textarea
                  rows={3}
                  value={tForm.quote}
                  onChange={(e) => setTForm({ ...tForm, quote: e.target.value })}
                  className={`${inputCls} resize-y`}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Name *</label>
                  <input value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Role *</label>
                  <input value={tForm.role} onChange={(e) => setTForm({ ...tForm, role: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Organization</label>
                  <input value={tForm.org} onChange={(e) => setTForm({ ...tForm, org: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Avatar URL</label>
                  <input value={tForm.avatar_url} onChange={(e) => setTForm({ ...tForm, avatar_url: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Sort order</label>
                  <input
                    type="number"
                    value={tForm.sort_order}
                    onChange={(e) => setTForm({ ...tForm, sort_order: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={tForm.is_published}
                    onChange={(e) => setTForm({ ...tForm, is_published: e.target.checked })}
                  />
                  Published
                </label>
              </div>
              {tError && <p className="text-[13px] font-medium text-red-600">{tError}</p>}
              <div className="flex gap-2">
                <button onClick={saveTestimonial} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  {tEditingId ? "Save changes" : "Create"}
                </button>
                <button onClick={() => setTOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : testimonials.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              No testimonials yet. The section is hidden on /partners until you publish one.
            </p>
          ) : (
            testimonials.map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[14px] text-slate-800">&ldquo;{t.quote}&rdquo;</p>
                  <p className="mt-1 text-[12.5px] text-slate-500">
                    {t.name} · {t.role}
                    {t.org ? ` · ${t.org}` : ""} · #{t.sort_order}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => toggleTestimonial(t)} title="Toggle published">
                    <PublishPill on={t.is_published} />
                  </button>
                  <button onClick={() => openEditTestimonial(t)} className="text-[13px] font-medium text-slate-600 hover:text-slate-900">
                    Edit
                  </button>
                  <button onClick={() => deleteTestimonial(t)} className="text-[13px] font-medium text-red-600 hover:text-red-700">
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Partners */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-slate-900">Partners</h2>
          <button
            onClick={openNewPartner}
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            + New partner
          </button>
        </div>

        {pOpen && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Name *</label>
                  <input value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Sort order</label>
                  <input
                    type="number"
                    value={pForm.sort_order}
                    onChange={(e) => setPForm({ ...pForm, sort_order: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Logo URL</label>
                  <input value={pForm.logo_url} onChange={(e) => setPForm({ ...pForm, logo_url: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Link URL</label>
                  <input value={pForm.url} onChange={(e) => setPForm({ ...pForm, url: e.target.value })} className={inputCls} />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={pForm.is_published}
                    onChange={(e) => setPForm({ ...pForm, is_published: e.target.checked })}
                  />
                  Published
                </label>
              </div>
              {pError && <p className="text-[13px] font-medium text-red-600">{pError}</p>}
              <div className="flex gap-2">
                <button onClick={savePartner} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  {pEditingId ? "Save changes" : "Create"}
                </button>
                <button onClick={() => setPOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : partners.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              No partners yet. The logo row is hidden on /partners until you publish one.
            </p>
          ) : (
            partners.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-slate-800">{p.name}</p>
                  <p className="truncate text-[12.5px] text-slate-500">
                    {p.url || p.logo_url || "no links"} · #{p.sort_order}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => togglePartner(p)} title="Toggle published">
                    <PublishPill on={p.is_published} />
                  </button>
                  <button onClick={() => openEditPartner(p)} className="text-[13px] font-medium text-slate-600 hover:text-slate-900">
                    Edit
                  </button>
                  <button onClick={() => deletePartner(p)} className="text-[13px] font-medium text-red-600 hover:text-red-700">
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
