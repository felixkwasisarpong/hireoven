"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Mail, Shield, UserRound, UserX } from "lucide-react"
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
}

export default function AdminUsersPage() {
  const { pushToast } = useToast()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  async function loadUsers() {
    setLoading(true)
    const response = await fetch("/api/admin/users", { cache: "no-store" })
    const body = (await response.json()) as { error?: string; users?: UserRow[] }

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load users",
        description: body.error ?? "Unknown error",
      })
      setLoading(false)
      return
    }

    setUsers(body.users ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users.filter((user) => {
      if (!query) return true
      return (
        user.email?.toLowerCase().includes(query) ||
        user.name?.toLowerCase().includes(query) ||
        user.visaStatus?.toLowerCase().includes(query)
      )
    })
  }, [search, users])

  const selectedUser = visibleUsers.find((user) => user.id === selectedId) ?? null
  const totalUsers = users.length
  const internationalUsers = users.filter((user) => user.isInternational).length
  const pushEnabledUsers = users.filter((user) => user.pushEnabled).length
  const activeSevenDays = users.filter((user) => {
    if (!user.lastActiveAt) return false
    return Date.now() - new Date(user.lastActiveAt).getTime() <= 7 * 86_400_000
  }).length

  async function updateUser(body: Record<string, unknown>, successMessage: string) {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const payload = (await response.json()) as { error?: string }

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "User update failed",
        description: payload.error ?? "Unknown error",
      })
      return false
    }

    pushToast({
      tone: "success",
      title: successMessage,
    })
    return true
  }

  async function toggleAdmin(user: UserRow) {
    setBusyId(user.id)
    const ok = await updateUser(
      { action: "toggle-admin", userId: user.id, isAdmin: !user.isAdmin },
      !user.isAdmin ? "Admin access granted" : "Admin access removed"
    )
    setBusyId(null)
    if (!ok) return
    setUsers((current) =>
      current.map((entry) =>
        entry.id === user.id ? { ...entry, isAdmin: !entry.isAdmin } : entry
      )
    )
  }

  async function suspendUser(user: UserRow) {
    if (!window.confirm(`Suspend ${user.email ?? user.name ?? "this user"}?`)) return
    setBusyId(user.id)
    const ok = await updateUser(
      { action: "suspend", userId: user.id },
      "User suspended"
    )
    setBusyId(null)
    if (!ok) return
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Users"
        title="User operations"
        description="See who is using Hireoven, who depends on sponsorship data, and which accounts have enough privileges to operate the system."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Total users" value={formatNumber(totalUsers)} />
        <AdminStatCard
          label="International users"
          value={formatNumber(internationalUsers)}
          hint={`${totalUsers ? Math.round((internationalUsers / totalUsers) * 100) : 0}% of all users`}
          tone="info"
        />
        <AdminStatCard
          label="Push enabled"
          value={formatNumber(pushEnabledUsers)}
          hint="Subscribed for instant browser notifications"
          tone="success"
        />
        <AdminStatCard
          label="Active in last 7 days"
          value={formatNumber(activeSevenDays)}
          tone="default"
        />
      </div>

      <AdminPanel
        title="User table"
        description="Toggle admin access, inspect account health, and reach out to high-value users without leaving the control room."
      >
        <div className="mb-4">
          <AdminInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search email, name, visa status"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Joined</th>
                <th className="px-3 py-3">Visa status</th>
                <th className="px-3 py-3">Watchlist</th>
                <th className="px-3 py-3">Alerts</th>
                <th className="px-3 py-3">Last active</th>
                <th className="px-3 py-3">Is admin</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                    <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                    Loading users
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                    No users match the current filters.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="px-3 py-4 font-medium text-gray-900">
                      {user.email ?? "Unknown"}
                    </td>
                    <td className="px-3 py-4 text-gray-600">{user.name ?? "No name"}</td>
                    <td className="px-3 py-4 text-gray-600">{formatDateTime(user.joinedAt)}</td>
                    <td className="px-3 py-4">
                      {user.visaStatus ? (
                        <AdminBadge tone={user.isInternational ? "info" : "neutral"}>
                          {user.visaStatus}
                        </AdminBadge>
                      ) : (
                        <span className="text-gray-400">Not set</span>
                      )}
                    </td>
                    <td className="px-3 py-4 text-gray-600">{formatNumber(user.watchlistCount)}</td>
                    <td className="px-3 py-4 text-gray-600">{formatNumber(user.alertCount)}</td>
                    <td className="px-3 py-4">
                      <p className="text-gray-900">{formatDateTime(user.lastActiveAt)}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {formatRelativeTime(user.lastActiveAt, now)}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <button
                        type="button"
                        onClick={() => void toggleAdmin(user)}
                        disabled={busyId === user.id}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          user.isAdmin
                            ? "bg-sky-50 text-sky-700"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {busyId === user.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Shield className="h-3.5 w-3.5" />
                        )}
                        {user.isAdmin ? "Admin" : "Standard"}
                      </button>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap gap-2">
                        <AdminButton
                          tone="ghost"
                          className="px-3 py-2 text-xs"
                          onClick={() => setSelectedId(user.id)}
                        >
                          <UserRound className="mr-2 h-4 w-4" />
                          View profile
                        </AdminButton>
                        <AdminButton
                          tone="secondary"
                          className="px-3 py-2 text-xs"
                          onClick={() => {
                            if (user.email) {
                              window.location.href = `mailto:${user.email}`
                            }
                          }}
                        >
                          <Mail className="mr-2 h-4 w-4" />
                          Send email
                        </AdminButton>
                        <AdminButton
                          tone="danger"
                          className="px-3 py-2 text-xs"
                          onClick={() => void suspendUser(user)}
                        >
                          <UserX className="mr-2 h-4 w-4" />
                          Suspend
                        </AdminButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      {selectedUser ? (
        <AdminPanel
          title={`User profile: ${selectedUser.email ?? selectedUser.name ?? "Unknown"}`}
          description="Quick profile view for account health, international status, and engagement depth."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Name</p>
              <p className="mt-3 text-base font-semibold text-gray-900">
                {selectedUser.name ?? "No name saved"}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Joined</p>
              <p className="mt-3 text-base font-semibold text-gray-900">
                {formatDateTime(selectedUser.joinedAt)}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">International</p>
              <p className="mt-3 text-base font-semibold text-gray-900">
                {selectedUser.isInternational ? "Yes" : "No"}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Push alerts</p>
              <p className="mt-3 text-base font-semibold text-gray-900">
                {selectedUser.pushEnabled ? "Enabled" : "Disabled"}
              </p>
            </div>
          </div>
        </AdminPanel>
      ) : null}
    </div>
  )
}
