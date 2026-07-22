"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, FileText, Loader2, Mail, Send, Shield, UserRound, UserX, X } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/admin/format"

type UserRow = {
  id: string
  email: string | null
  name: string | null
  joinedAt: string | null
  lastActiveAt: string | null
  isAdmin: boolean
  visaStatus: string | null
  isInternational: boolean
  watchlistCount: number
  alertCount: number
  pushEnabled: boolean
  hasResume: boolean
  plan: string
  planStatus: string
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  pro_max: "Pro Max",
  pro_international: "Pro Max",
}

const PLAN_STYLES: Record<string, string> = {
  free:              "bg-slate-100 text-slate-600",
  pro:               "bg-orange-100 text-orange-700",
  pro_max:           "bg-violet-100 text-violet-700",
  pro_international: "bg-violet-100 text-violet-700",
}

function ActivityDot({ lastActiveAt, now }: { lastActiveAt: string | null; now: number }) {
  if (!lastActiveAt) return <span className="inline-block h-2 w-2 rounded-full bg-gray-200" title="Never seen" />
  const diffMin = (now - new Date(lastActiveAt).getTime()) / 60_000
  if (diffMin < 15) return <span className="inline-block h-2 w-2 rounded-full bg-green-500 shadow-[0_0_0_2px_rgba(34,197,94,0.25)]" title="Online now" />
  if (diffMin < 60) return <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" title="Active in last hour" />
  return <span className="inline-block h-2 w-2 rounded-full bg-gray-200" title="Inactive" />
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${PLAN_STYLES[plan] ?? PLAN_STYLES.free}`}>
      {PLAN_LABELS[plan] ?? plan}
    </span>
  )
}

function PlanSelector({
  userId,
  currentPlan,
  onChanged,
}: {
  userId: string
  currentPlan: string
  onChanged: (userId: string, plan: string) => void
}) {
  const { pushToast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const plans = [
    { value: "free",              label: "Free",    style: "text-slate-700 hover:bg-slate-50" },
    { value: "pro",               label: "Pro",     style: "text-orange-700 hover:bg-orange-50" },
    { value: "pro_max",           label: "Pro Max", style: "text-violet-700 hover:bg-violet-50" },
  ]

  async function setPlan(plan: string) {
    if (plan === currentPlan) { setOpen(false); return }
    setBusy(true)
    setOpen(false)
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-plan", userId, plan }),
    })
    setBusy(false)
    if (res.ok) {
      pushToast({ tone: "success", title: `Plan set to ${PLAN_LABELS[plan] ?? plan}` })
      onChanged(userId, plan)
    } else {
      const data = await res.json().catch(() => ({})) as { error?: string }
      pushToast({ tone: "error", title: "Plan update failed", description: data.error })
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlanBadge plan={currentPlan} />}
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
            {plans.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => void setPlan(p.value)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] font-semibold transition ${p.style} ${currentPlan === p.value ? "opacity-50 cursor-default" : ""}`}
              >
                {p.label}
                {currentPlan === p.value && <span className="ml-auto text-[9px] text-slate-400">current</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminUsersPage() {
  const { pushToast } = useToast()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [composeOpen, setComposeOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState("")
  const [emailBody, setEmailBody] = useState("")
  const [sendingEmail, setSendingEmail] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  async function loadUsers() {
    setLoading(true)
    const res = await fetch("/api/admin/users", { cache: "no-store" })
    const body = (await res.json()) as { error?: string; users?: UserRow[] }
    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to load users", description: body.error })
      setLoading(false)
      return
    }
    setUsers(body.users ?? [])
    setLoading(false)
  }

  useEffect(() => { void loadUsers() }, [])
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      u.email?.toLowerCase().includes(q) ||
      u.name?.toLowerCase().includes(q) ||
      u.visaStatus?.toLowerCase().includes(q) ||
      u.plan?.toLowerCase().includes(q)
    )
  }, [search, users])

  const selectedUser = visibleUsers.find((u) => u.id === selectedId) ?? null

  const checkableVisibleIds = useMemo(
    () => visibleUsers.filter((u) => u.email).map((u) => u.id),
    [visibleUsers]
  )
  const allVisibleChecked =
    checkableVisibleIds.length > 0 && checkableVisibleIds.every((id) => checkedIds.has(id))

  function toggleChecked(userId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function toggleCheckAllVisible() {
    setCheckedIds((prev) => {
      if (allVisibleChecked) {
        const next = new Set(prev)
        checkableVisibleIds.forEach((id) => next.delete(id))
        return next
      }
      return new Set([...prev, ...checkableVisibleIds])
    })
  }

  function clearSelection() {
    setCheckedIds(new Set())
    setComposeOpen(false)
  }

  async function sendBulkEmail() {
    if (checkedIds.size === 0 || !emailSubject.trim() || !emailBody.trim()) return
    setSendingEmail(true)
    setSendResult(null)
    setSendError(null)
    try {
      const response = await fetch("/api/admin/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Manual send to ${checkedIds.size} user${checkedIds.size === 1 ? "" : "s"}`,
          subject: emailSubject,
          bodyText: emailBody,
          segment: "selected_users",
          userIds: Array.from(checkedIds),
          sendNow: true,
        }),
      })
      const data = (await response.json()) as {
        error?: string
        sent?: number
        failed?: number
        totalRecipients?: number
      }
      if (!response.ok) throw new Error(data.error ?? "Could not send email")
      setSendResult(
        `Sent to ${data.sent ?? 0}/${data.totalRecipients ?? 0} recipients${
          data.failed ? `, ${data.failed} failed` : ""
        }.`
      )
      setEmailSubject("")
      setEmailBody("")
      setCheckedIds(new Set())
    } catch (error) {
      setSendError((error as Error).message)
    } finally {
      setSendingEmail(false)
    }
  }

  const stats = useMemo(() => ({
    total: users.length,
    intl: users.filter((u) => u.isInternational).length,
    pro: users.filter((u) => u.plan === "pro" || u.plan === "pro_max" || u.plan === "pro_international").length,
    active7d: users.filter((u) => u.lastActiveAt && Date.now() - new Date(u.lastActiveAt).getTime() <= 7 * 86_400_000).length,
  }), [users])

  async function updateUser(body: Record<string, unknown>, msg: string) {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) { pushToast({ tone: "error", title: "Update failed", description: data.error }); return false }
    pushToast({ tone: "success", title: msg })
    return true
  }

  async function toggleAdmin(user: UserRow) {
    setBusyId(user.id)
    const ok = await updateUser(
      { action: "toggle-admin", userId: user.id, isAdmin: !user.isAdmin },
      !user.isAdmin ? "Admin access granted" : "Admin access removed"
    )
    setBusyId(null)
    if (ok) setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, isAdmin: !u.isAdmin } : u))
  }

  async function suspendUser(user: UserRow) {
    if (!window.confirm(`Suspend ${user.email ?? user.name ?? "this user"}?`)) return
    setBusyId(user.id)
    await updateUser({ action: "suspend", userId: user.id }, "User suspended")
    setBusyId(null)
  }

  function onPlanChanged(userId: string, plan: string) {
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, plan } : u))
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Users"
        title="User management"
        description="Upgrade, downgrade, toggle admin, and suspend accounts directly — no Stripe required."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Total users" value={formatNumber(stats.total)} />
        <AdminStatCard
          label="Paid (Pro + Max)"
          value={formatNumber(stats.pro)}
          hint={`${stats.total ? Math.round((stats.pro / stats.total) * 100) : 0}% of users`}
          tone="success"
        />
        <AdminStatCard
          label="International"
          value={formatNumber(stats.intl)}
          hint={`${stats.total ? Math.round((stats.intl / stats.total) * 100) : 0}% of users`}
          tone="info"
        />
        <AdminStatCard label="Active last 7 days" value={formatNumber(stats.active7d)} />
      </div>

      <AdminPanel
        title="Users"
        description="Click the plan badge dropdown to upgrade or downgrade any account instantly."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <AdminInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email, name, visa status, or plan"
            />
          </div>
          {checkedIds.size > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
              <span className="text-xs font-semibold text-sky-800">
                {checkedIds.size} selected
              </span>
              <AdminButton
                tone="primary"
                className="px-2.5 py-1.5 text-xs"
                onClick={() => setComposeOpen(true)}
              >
                <Mail className="mr-1 h-3.5 w-3.5" /> Email selected
              </AdminButton>
              <AdminButton tone="ghost" className="px-2.5 py-1.5 text-xs" onClick={clearSelection}>
                <X className="mr-1 h-3.5 w-3.5" /> Clear
              </AdminButton>
            </div>
          )}
        </div>

        {composeOpen && (
          <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">
              Email {checkedIds.size} selected user{checkedIds.size === 1 ? "" : "s"}
            </p>
            <p className="mb-4 text-xs text-gray-500">
              Sends from your configured support sender and includes a one-click unsubscribe link automatically.
            </p>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                Subject
              </label>
              <AdminInput
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="What's this about?"
              />
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                Message
              </label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                placeholder={"Hi there,\n\n..."}
                className="min-h-[160px] w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none shadow-[0_8px_20px_rgba(15,23,42,0.03)] placeholder:text-gray-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
              />
            </div>

            {sendError ? (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {sendError}
              </p>
            ) : null}
            {sendResult ? (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {sendResult}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <AdminButton
                disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
                onClick={() => void sendBulkEmail()}
              >
                {sendingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send to {checkedIds.size} user{checkedIds.size === 1 ? "" : "s"}
              </AdminButton>
              <AdminButton tone="secondary" disabled={sendingEmail} onClick={() => setComposeOpen(false)}>
                Cancel
              </AdminButton>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleCheckAllVisible}
                    disabled={checkableVisibleIds.length === 0}
                    aria-label="Select all visible users"
                  />
                </th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Joined</th>
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3">Visa</th>
                <th className="px-3 py-3">Resume</th>
                <th className="px-3 py-3">Watch</th>
                <th className="px-3 py-3">Last active</th>
                <th className="px-3 py-3">Admin</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-gray-400">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Loading users…
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-gray-400">
                    No users match your search.
                  </td>
                </tr>
              ) : visibleUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={checkedIds.has(user.id)}
                      onChange={() => toggleChecked(user.id)}
                      disabled={!user.email}
                      aria-label={`Select ${user.email ?? user.name ?? "user"}`}
                    />
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900">{user.email ?? "—"}</td>
                  <td className="px-3 py-3 text-gray-600">{user.name ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{formatDateTime(user.joinedAt)}</td>

                  {/* Plan dropdown */}
                  <td className="px-3 py-3">
                    <PlanSelector
                      userId={user.id}
                      currentPlan={user.plan}
                      onChanged={onPlanChanged}
                    />
                  </td>

                  <td className="px-3 py-3">
                    {user.visaStatus ? (
                      <AdminBadge tone={user.isInternational ? "info" : "neutral"}>
                        {user.visaStatus}
                      </AdminBadge>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {user.hasResume ? (
                      <AdminBadge tone="success">
                        <FileText className="mr-1 h-3 w-3" /> Uploaded
                      </AdminBadge>
                    ) : (
                      <AdminBadge tone="neutral">None</AdminBadge>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-600">{formatNumber(user.watchlistCount)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <ActivityDot lastActiveAt={user.lastActiveAt} now={now} />
                      <div>
                        <p className="text-xs text-gray-600">{formatDateTime(user.lastActiveAt) ?? "Never"}</p>
                        <p className="mt-0.5 text-[10px] text-gray-400">{formatRelativeTime(user.lastActiveAt, now)}</p>
                      </div>
                    </div>
                  </td>

                  {/* Admin toggle */}
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => void toggleAdmin(user)}
                      disabled={busyId === user.id}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                        user.isAdmin ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {busyId === user.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Shield className="h-3 w-3" />
                      }
                      {user.isAdmin ? "Admin" : "User"}
                    </button>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <AdminButton tone="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setSelectedId(user.id)}>
                        <UserRound className="mr-1 h-3.5 w-3.5" /> Profile
                      </AdminButton>
                      <AdminButton
                        tone="secondary"
                        className="px-2.5 py-1.5 text-xs"
                        onClick={() => { if (user.email) window.location.href = `mailto:${user.email}` }}
                      >
                        <Mail className="mr-1 h-3.5 w-3.5" /> Email
                      </AdminButton>
                      <AdminButton tone="danger" className="px-2.5 py-1.5 text-xs" onClick={() => void suspendUser(user)}>
                        <UserX className="mr-1 h-3.5 w-3.5" /> Suspend
                      </AdminButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      {selectedUser && (
        <AdminPanel
          title={`Profile: ${selectedUser.email ?? selectedUser.name ?? "Unknown"}`}
          description="Account snapshot."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Name",        value: selectedUser.name ?? "Not set" },
              { label: "Plan",        value: PLAN_LABELS[selectedUser.plan] ?? selectedUser.plan },
              { label: "Joined",      value: formatDateTime(selectedUser.joinedAt) },
              { label: "International", value: selectedUser.isInternational ? "Yes" : "No" },
              { label: "Watchlist",   value: String(selectedUser.watchlistCount) },
              { label: "Alerts",      value: String(selectedUser.alertCount) },
              { label: "Push",        value: selectedUser.pushEnabled ? "Enabled" : "Disabled" },
              { label: "Resume",      value: selectedUser.hasResume ? "Uploaded" : "Not uploaded" },
              { label: "Visa status", value: selectedUser.visaStatus ?? "Not set" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
                <p className="mt-2 text-sm font-semibold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        </AdminPanel>
      )}
    </div>
  )
}
