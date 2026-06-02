"use client"

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Copy, Loader2, RefreshCw, RotateCw, ShieldCheck, ShieldX } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminSelect,
  AdminStatCard,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/admin/format"

type SignalApiKey = {
  id: string
  tenantId: string
  name: string
  keyPrefix: string
  scopes: string[]
  defaultUserId: string | null
  createdByUserId: string | null
  isActive: boolean
  expiresAt: string | null
  lastUsedAt: string | null
  usageCount: number
  metadata: unknown
  revokedAt: string | null
  createdAt: string | null
}

type KeyActionResponse = {
  error?: string
  key?: SignalApiKey
  apiKey?: string
}

type EditDraft = {
  name: string
  scopes: string
  defaultUserId: string
  expiresAt: string
}

type TenantUser = {
  userId: string
  email: string | null
  fullName: string | null
  createdAt: string | null
  createdByUserId: string | null
}

type SignalApiQuotaPolicy = {
  tenantId: string
  planName: string
  enforce: boolean
  dailyLimit: number | null
  monthlyLimit: number | null
  dailyUsed: number
  monthlyUsed: number
  metadata: unknown
  createdByUserId: string | null
  updatedByUserId: string | null
  createdAt: string | null
  updatedAt: string | null
}

type QuotaResponse = {
  error?: string
  policy?: SignalApiQuotaPolicy | null
  policies?: SignalApiQuotaPolicy[]
}

type SignalApiUsageSummary = {
  totalRequests: number
  successRequests: number
  errorRequests: number
  avgLatencyMs: number
  lastRequestAt: string | null
  distinctTenants: number
  distinctKeys: number
}

type SignalApiUsageTopRoute = {
  route: string
  requestCount: number
  errorCount: number
  avgLatencyMs: number
}

type SignalApiTenantUsage = {
  tenantId: string
  requestCount: number
  errorCount: number
  lastRequestAt: string | null
}

type SignalApiRecentRequest = {
  requestId: string
  tenantId: string
  route: string
  method: string
  status: number
  latencyMs: number
  createdAt: string | null
  apiKeyId: string | null
  apiKeyName: string | null
  apiKeyPrefix: string | null
}

type SignalApiUsageResponse = {
  error?: string
  summary?: SignalApiUsageSummary
  topRoutes?: SignalApiUsageTopRoute[]
  tenants?: SignalApiTenantUsage[]
  recentRequests?: SignalApiRecentRequest[]
}

type SignalApiWebhookSubscription = {
  id: string
  tenantId: string
  name: string
  targetUrl: string
  eventTypes: string[]
  isActive: boolean
  createdByUserId: string | null
  updatedByUserId: string | null
  lastDeliveryAt: string | null
  lastFailureAt: string | null
  consecutiveFailures: number
  metadata: unknown
  createdAt: string | null
  updatedAt: string | null
  secretPrefix: string
  deliveryCount: number
  failureCount: number
  latestStatusCode: number | null
  latestSuccess: boolean | null
}

type SignalApiWebhookDelivery = {
  id: string
  subscriptionId: string
  subscriptionName: string | null
  tenantId: string
  eventId: string
  eventType: string
  targetUrl: string
  attemptNumber: number
  statusCode: number | null
  success: boolean
  durationMs: number
  errorMessage: string | null
  responseBody: string | null
  createdAt: string | null
  jobStatus: string | null
  jobAttemptCount: number
  jobMaxAttempts: number
  jobNextAttemptAt: string | null
  jobDeliveredAt: string | null
}

type SignalApiWebhooksResponse = {
  error?: string
  subscriptions?: SignalApiWebhookSubscription[]
  subscription?: SignalApiWebhookSubscription
  signingSecret?: string
  ok?: boolean
  eventId?: string
  subscriptionCount?: number
  queuedCount?: number
}

type SignalApiWebhookDeliveriesResponse = {
  error?: string
  deliveries?: SignalApiWebhookDelivery[]
}

type SignalApiWebhookDeliveryActionResponse = {
  error?: string
  ok?: boolean
  replayedCount?: number
  subscriptionId?: string
  eventId?: string
  claimedCount?: number
  deliveredCount?: number
  rescheduledCount?: number
  deadLetterCount?: number
  failedCount?: number
}

function parseScopes(raw: string): string[] {
  return [...new Set(raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean))]
}

function parseWebhookEventTypes(raw: string): string[] {
  return [...new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )]
}

function formatLimit(value: number | null): string {
  return value == null ? "Unlimited" : formatNumber(value)
}

function formatLatency(value: number): string {
  return `${formatNumber(Math.round(value))}ms`
}

function statusTone(status: number): "success" | "warning" | "danger" | "neutral" {
  if (status >= 500) return "danger"
  if (status >= 400) return "warning"
  if (status >= 200) return "success"
  return "neutral"
}

function webhookQueueTone(status: string | null): "success" | "warning" | "danger" | "neutral" {
  if (status === "delivered") return "success"
  if (status === "pending" || status === "processing") return "warning"
  if (status === "dead_letter") return "danger"
  return "neutral"
}

function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toIsoFromLocalInput(localValue: string): string | null {
  if (!localValue) return null
  const parsed = new Date(localValue)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toISOString()
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (!navigator?.clipboard) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function triggerDownload(url: string) {
  const link = document.createElement("a")
  link.href = url
  link.target = "_blank"
  link.rel = "noopener noreferrer"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export default function AdminSignalApiPage() {
  const { pushToast } = useToast()
  const [keys, setKeys] = useState<SignalApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [tenantFilterInput, setTenantFilterInput] = useState("")
  const [appliedTenantFilter, setAppliedTenantFilter] = useState("")
  const [includeInactive, setIncludeInactive] = useState(true)
  const [createBusy, setCreateBusy] = useState(false)
  const [busyActionKeyId, setBusyActionKeyId] = useState<string | null>(null)
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [membershipTenantId, setMembershipTenantId] = useState("")
  const [membershipUserId, setMembershipUserId] = useState("")
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
  const [tenantUsersLoading, setTenantUsersLoading] = useState(false)
  const [tenantUsersBusy, setTenantUsersBusy] = useState(false)
  const [quotaTenantId, setQuotaTenantId] = useState("")
  const [quotaPlanName, setQuotaPlanName] = useState("starter")
  const [quotaEnforce, setQuotaEnforce] = useState(true)
  const [quotaDailyLimit, setQuotaDailyLimit] = useState("")
  const [quotaMonthlyLimit, setQuotaMonthlyLimit] = useState("")
  const [quotaPolicies, setQuotaPolicies] = useState<SignalApiQuotaPolicy[]>([])
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [quotaBusy, setQuotaBusy] = useState(false)
  const [usageLookbackHours, setUsageLookbackHours] = useState("168")
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageSummary, setUsageSummary] = useState<SignalApiUsageSummary>({
    totalRequests: 0,
    successRequests: 0,
    errorRequests: 0,
    avgLatencyMs: 0,
    lastRequestAt: null,
    distinctTenants: 0,
    distinctKeys: 0,
  })
  const [usageTopRoutes, setUsageTopRoutes] = useState<SignalApiUsageTopRoute[]>([])
  const [usageTenants, setUsageTenants] = useState<SignalApiTenantUsage[]>([])
  const [usageRecentRequests, setUsageRecentRequests] = useState<SignalApiRecentRequest[]>([])
  const [webhookSubscriptions, setWebhookSubscriptions] = useState<SignalApiWebhookSubscription[]>([])
  const [webhookDeliveries, setWebhookDeliveries] = useState<SignalApiWebhookDelivery[]>([])
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookBusyId, setWebhookBusyId] = useState<string | null>(null)
  const [createWebhookBusy, setCreateWebhookBusy] = useState(false)
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>({
    name: "",
    scopes: "",
    defaultUserId: "",
    expiresAt: "",
  })

  const [createForm, setCreateForm] = useState({
    tenantId: "",
    name: "",
    scopes: "",
    defaultUserId: "",
    expiresDays: "",
  })
  const [createWebhookForm, setCreateWebhookForm] = useState({
    tenantId: "",
    name: "",
    targetUrl: "",
    eventTypes: "",
  })

  const loadKeys = useCallback(async () => {
    setLoading(true)
    const query = new URLSearchParams()
    if (appliedTenantFilter.trim()) query.set("tenantId", appliedTenantFilter.trim())
    query.set("includeInactive", includeInactive ? "true" : "false")

    const res = await fetch(`/api/admin/signal-api-keys?${query.toString()}`, {
      cache: "no-store",
    })
    const body = (await res.json()) as { keys?: SignalApiKey[]; error?: string }

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load Signal API keys",
        description: body.error ?? "Unknown error",
      })
      setLoading(false)
      return
    }

    setKeys(body.keys ?? [])
    setLoading(false)
  }, [appliedTenantFilter, includeInactive, pushToast])

  const loadUsage = useCallback(async () => {
    setUsageLoading(true)
    const query = new URLSearchParams()
    if (appliedTenantFilter.trim()) query.set("tenantId", appliedTenantFilter.trim())
    query.set("hours", usageLookbackHours)
    query.set("limit", "50")

    const res = await fetch(`/api/admin/signal-api-usage?${query.toString()}`, {
      cache: "no-store",
    })
    const body = (await res.json()) as SignalApiUsageResponse
    setUsageLoading(false)

    if (!res.ok || !body.summary) {
      pushToast({
        tone: "error",
        title: "Unable to load Signal API usage",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setUsageSummary(body.summary)
    setUsageTopRoutes(body.topRoutes ?? [])
    setUsageTenants(body.tenants ?? [])
    setUsageRecentRequests(body.recentRequests ?? [])
  }, [appliedTenantFilter, pushToast, usageLookbackHours])

  const loadWebhookSubscriptions = useCallback(async () => {
    setWebhookLoading(true)
    const query = new URLSearchParams()
    if (appliedTenantFilter.trim()) query.set("tenantId", appliedTenantFilter.trim())

    const [subsRes, deliveriesRes] = await Promise.all([
      fetch(`/api/admin/signal-api-webhooks?${query.toString()}`, {
        cache: "no-store",
      }),
      fetch(`/api/admin/signal-api-webhook-deliveries?${query.toString()}`, {
        cache: "no-store",
      }),
    ])

    const subsBody = (await subsRes.json()) as SignalApiWebhooksResponse
    const deliveriesBody = (await deliveriesRes.json()) as SignalApiWebhookDeliveriesResponse
    setWebhookLoading(false)

    if (!subsRes.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load webhook subscriptions",
        description: subsBody.error ?? "Unknown error",
      })
      return
    }

    if (!deliveriesRes.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load webhook deliveries",
        description: deliveriesBody.error ?? "Unknown error",
      })
      return
    }

    setWebhookSubscriptions(subsBody.subscriptions ?? [])
    setWebhookDeliveries(deliveriesBody.deliveries ?? [])
  }, [appliedTenantFilter, pushToast])

  function usageCsvUrl(dataset: "recentRequests" | "tenants" | "topRoutes") {
    const query = new URLSearchParams()
    if (appliedTenantFilter.trim()) query.set("tenantId", appliedTenantFilter.trim())
    query.set("hours", usageLookbackHours)
    query.set("limit", "500")
    query.set("format", "csv")
    query.set("dataset", dataset)
    return `/api/admin/signal-api-usage?${query.toString()}`
  }

  function webhookDeliveriesCsvUrl() {
    const query = new URLSearchParams()
    if (appliedTenantFilter.trim()) query.set("tenantId", appliedTenantFilter.trim())
    query.set("limit", "500")
    query.set("format", "csv")
    query.set("outcome", "all")
    return `/api/admin/signal-api-webhook-deliveries?${query.toString()}`
  }

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  useEffect(() => {
    void loadWebhookSubscriptions()
  }, [loadWebhookSubscriptions])

  useEffect(() => {
    void loadQuotaPolicies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const stats = useMemo(() => {
    const active = keys.filter((k) => k.isActive).length
    const used24h = keys.filter((k) => {
      if (!k.lastUsedAt) return false
      return now - new Date(k.lastUsedAt).getTime() <= 86_400_000
    }).length
    const expiresSoon = keys.filter((k) => {
      if (!k.expiresAt) return false
      const ms = new Date(k.expiresAt).getTime() - now
      return ms > 0 && ms <= 7 * 86_400_000
    }).length

    return {
      total: keys.length,
      active,
      used24h,
      expiresSoon,
    }
  }, [keys, now])

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!createForm.tenantId.trim() || !createForm.name.trim()) {
      pushToast({
        tone: "error",
        title: "Missing required fields",
        description: "tenantId and name are required.",
      })
      return
    }

    const expiresDaysRaw = createForm.expiresDays.trim()
    const expiresDays = expiresDaysRaw ? Number.parseInt(expiresDaysRaw, 10) : null
    if (expiresDaysRaw && (!Number.isFinite(expiresDays) || expiresDays! <= 0)) {
      pushToast({
        tone: "error",
        title: "Invalid expiration",
        description: "expiresDays must be a positive integer.",
      })
      return
    }

    setCreateBusy(true)
    const response = await fetch("/api/admin/signal-api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: createForm.tenantId.trim(),
        name: createForm.name.trim(),
        scopes: parseScopes(createForm.scopes),
        defaultUserId: createForm.defaultUserId.trim() || null,
        expiresDays: expiresDays ?? undefined,
      }),
    })

    const data = (await response.json()) as KeyActionResponse
    setCreateBusy(false)

    if (!response.ok || !data.key || !data.apiKey) {
      pushToast({
        tone: "error",
        title: "Failed to create key",
        description: data.error ?? "Unknown error",
      })
      return
    }

    setRevealedApiKey(data.apiKey)
    setKeys((prev) => [data.key!, ...prev])
    setCreateForm({
      tenantId: createForm.tenantId,
      name: "",
      scopes: "",
      defaultUserId: "",
      expiresDays: "",
    })
    pushToast({ tone: "success", title: "Signal API key created" })
  }

  async function runKeyAction(key: SignalApiKey, action: "revoke" | "reactivate" | "rotate") {
    if (action === "revoke" && !window.confirm(`Revoke key "${key.name}"?`)) return
    if (action === "rotate" && !window.confirm(`Rotate key "${key.name}"? Existing clients will stop working until they use the new key.`)) return

    setBusyActionKeyId(key.id)
    const res = await fetch(`/api/admin/signal-api-keys/${key.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    const body = (await res.json()) as KeyActionResponse
    setBusyActionKeyId(null)

    if (!res.ok || !body.key) {
      pushToast({
        tone: "error",
        title: "Key action failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setKeys((prev) => prev.map((item) => (item.id === body.key!.id ? body.key! : item)))
    if (body.apiKey) setRevealedApiKey(body.apiKey)
    pushToast({
      tone: "success",
      title:
        action === "revoke"
          ? "Key revoked"
          : action === "reactivate"
            ? "Key reactivated"
            : "Key rotated",
    })
  }

  function startEdit(key: SignalApiKey) {
    setEditingKeyId(key.id)
    setEditDraft({
      name: key.name,
      scopes: key.scopes.join(", "),
      defaultUserId: key.defaultUserId ?? "",
      expiresAt: toDateTimeLocalValue(key.expiresAt),
    })
  }

  function cancelEdit() {
    setEditingKeyId(null)
    setEditBusy(false)
    setEditDraft({ name: "", scopes: "", defaultUserId: "", expiresAt: "" })
  }

  async function saveEdit(keyId: string) {
    setEditBusy(true)
    const payload = {
      action: "update",
      name: editDraft.name.trim(),
      scopes: parseScopes(editDraft.scopes),
      defaultUserId: editDraft.defaultUserId.trim() || null,
      expiresAt: toIsoFromLocalInput(editDraft.expiresAt),
    }

    const res = await fetch(`/api/admin/signal-api-keys/${keyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const body = (await res.json()) as KeyActionResponse
    setEditBusy(false)

    if (!res.ok || !body.key) {
      pushToast({
        tone: "error",
        title: "Update failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setKeys((prev) => prev.map((item) => (item.id === body.key!.id ? body.key! : item)))
    cancelEdit()
    pushToast({ tone: "success", title: "Key updated" })
  }

  async function loadTenantUsers(tenantOverride?: string) {
    const tenantId = (tenantOverride ?? membershipTenantId).trim()
    if (!tenantId) {
      pushToast({
        tone: "error",
        title: "Tenant is required",
        description: "Enter a tenantId to load allowlisted users.",
      })
      return
    }

    setTenantUsersLoading(true)
    const res = await fetch(
      `/api/admin/signal-api-tenants/${encodeURIComponent(tenantId)}/users`,
      { cache: "no-store" }
    )
    const body = (await res.json()) as { users?: TenantUser[]; error?: string }
    setTenantUsersLoading(false)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load tenant users",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setMembershipTenantId(tenantId)
    setTenantUsers(body.users ?? [])
  }

  async function addTenantUser() {
    const tenantId = membershipTenantId.trim()
    const userId = membershipUserId.trim()
    if (!tenantId || !userId) {
      pushToast({
        tone: "error",
        title: "tenantId and userId are required",
      })
      return
    }

    setTenantUsersBusy(true)
    const res = await fetch(
      `/api/admin/signal-api-tenants/${encodeURIComponent(tenantId)}/users`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }
    )
    const body = (await res.json()) as { error?: string }
    setTenantUsersBusy(false)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Failed to add tenant user",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setMembershipUserId("")
    pushToast({ tone: "success", title: "Tenant user added" })
    await loadTenantUsers(tenantId)
  }

  async function removeTenantUser(userId: string) {
    const tenantId = membershipTenantId.trim()
    if (!tenantId) return
    if (!window.confirm(`Remove ${userId} from tenant ${tenantId}?`)) return

    setTenantUsersBusy(true)
    const res = await fetch(
      `/api/admin/signal-api-tenants/${encodeURIComponent(tenantId)}/users?userId=${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
      }
    )
    const body = (await res.json()) as { error?: string }
    setTenantUsersBusy(false)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Failed to remove tenant user",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setTenantUsers((prev) => prev.filter((item) => item.userId !== userId))
    pushToast({ tone: "success", title: "Tenant user removed" })
  }

  function applyQuotaPolicyToForm(policy: SignalApiQuotaPolicy) {
    setQuotaTenantId(policy.tenantId)
    setQuotaPlanName(policy.planName)
    setQuotaEnforce(policy.enforce)
    setQuotaDailyLimit(policy.dailyLimit == null ? "" : String(policy.dailyLimit))
    setQuotaMonthlyLimit(policy.monthlyLimit == null ? "" : String(policy.monthlyLimit))
  }

  function parseLimitInput(
    raw: string,
    label: string
  ): { value?: number | null; error?: string } {
    const trimmed = raw.trim()
    if (!trimmed) return { value: null }
    if (["unlimited", "none", "null", "0", "-1"].includes(trimmed.toLowerCase())) {
      return { value: null }
    }

    const parsed = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: `${label} must be a positive integer or empty for unlimited.` }
    }
    return { value: parsed }
  }

  async function loadQuotaPolicies(tenantOverride?: string) {
    const tenantId = (tenantOverride ?? quotaTenantId).trim()
    setQuotaLoading(true)
    const query = new URLSearchParams()
    if (tenantId) query.set("tenantId", tenantId)
    const res = await fetch(`/api/admin/signal-api-quotas?${query.toString()}`, {
      cache: "no-store",
    })
    const body = (await res.json()) as QuotaResponse
    setQuotaLoading(false)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load quota policies",
        description: body.error ?? "Unknown error",
      })
      return
    }

    const policies = body.policies ?? []
    setQuotaPolicies(policies)
    if (tenantId && policies[0]) {
      applyQuotaPolicyToForm(policies[0])
    }
  }

  async function saveQuotaPolicy() {
    const tenantId = quotaTenantId.trim()
    if (!tenantId) {
      pushToast({
        tone: "error",
        title: "tenantId is required",
      })
      return
    }

    const daily = parseLimitInput(quotaDailyLimit, "Daily limit")
    if (daily.error) {
      pushToast({ tone: "error", title: "Invalid daily limit", description: daily.error })
      return
    }

    const monthly = parseLimitInput(quotaMonthlyLimit, "Monthly limit")
    if (monthly.error) {
      pushToast({ tone: "error", title: "Invalid monthly limit", description: monthly.error })
      return
    }

    setQuotaBusy(true)
    const res = await fetch("/api/admin/signal-api-quotas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        planName: quotaPlanName.trim() || "starter",
        enforce: quotaEnforce,
        dailyLimit: daily.value,
        monthlyLimit: monthly.value,
      }),
    })
    const body = (await res.json()) as QuotaResponse
    setQuotaBusy(false)

    if (!res.ok || !body.policy) {
      pushToast({
        tone: "error",
        title: "Failed to save quota policy",
        description: body.error ?? "Unknown error",
      })
      return
    }

    applyQuotaPolicyToForm(body.policy)
    setQuotaPolicies((prev) => {
      const next = prev.filter((item) => item.tenantId !== body.policy!.tenantId)
      return [body.policy!, ...next]
    })
    pushToast({ tone: "success", title: "Quota policy saved" })
  }

  async function deleteQuotaPolicy(tenantIdOverride?: string) {
    const tenantId = (tenantIdOverride ?? quotaTenantId).trim()
    if (!tenantId) {
      pushToast({ tone: "error", title: "tenantId is required" })
      return
    }

    if (!window.confirm(`Delete quota policy for tenant ${tenantId}?`)) return

    setQuotaBusy(true)
    const res = await fetch(`/api/admin/signal-api-quotas?tenantId=${encodeURIComponent(tenantId)}`, {
      method: "DELETE",
    })
    const body = (await res.json()) as QuotaResponse
    setQuotaBusy(false)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Failed to delete quota policy",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setQuotaPolicies((prev) => prev.filter((item) => item.tenantId !== tenantId))
    if (tenantId === quotaTenantId.trim()) {
      setQuotaPlanName("starter")
      setQuotaEnforce(true)
      setQuotaDailyLimit("")
      setQuotaMonthlyLimit("")
    }
    pushToast({ tone: "success", title: "Quota policy deleted" })
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !createWebhookForm.tenantId.trim() ||
      !createWebhookForm.name.trim() ||
      !createWebhookForm.targetUrl.trim()
    ) {
      pushToast({
        tone: "error",
        title: "Missing required fields",
        description: "tenantId, name, and targetUrl are required.",
      })
      return
    }

    setCreateWebhookBusy(true)
    const res = await fetch("/api/admin/signal-api-webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: createWebhookForm.tenantId.trim(),
        name: createWebhookForm.name.trim(),
        targetUrl: createWebhookForm.targetUrl.trim(),
        eventTypes: parseWebhookEventTypes(createWebhookForm.eventTypes),
      }),
    })
    const body = (await res.json()) as SignalApiWebhooksResponse
    setCreateWebhookBusy(false)

    if (!res.ok || !body.subscription || !body.signingSecret) {
      pushToast({
        tone: "error",
        title: "Failed to create webhook subscription",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setRevealedWebhookSecret(body.signingSecret)
    setWebhookSubscriptions((prev) => [body.subscription!, ...prev])
    setCreateWebhookForm((prev) => ({
      ...prev,
      name: "",
      targetUrl: "",
      eventTypes: "",
    }))
    pushToast({ tone: "success", title: "Webhook subscription created" })
  }

  async function runWebhookAction(
    subscription: SignalApiWebhookSubscription,
    action: "rotate" | "activate" | "deactivate" | "test"
  ) {
    if (action === "deactivate" && !window.confirm(`Deactivate webhook "${subscription.name}"?`)) {
      return
    }

    setWebhookBusyId(subscription.id)
    const res = await fetch(`/api/admin/signal-api-webhooks/${subscription.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    const body = (await res.json()) as SignalApiWebhooksResponse
    setWebhookBusyId(null)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Webhook action failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    if (body.subscription) {
      setWebhookSubscriptions((prev) =>
        prev.map((item) => (item.id === body.subscription!.id ? body.subscription! : item))
      )
    }

    if (body.signingSecret) {
      setRevealedWebhookSecret(body.signingSecret)
    }

    if (action === "test") {
      pushToast({
        tone: "success",
        title: "Test event queued",
        description:
          body.eventId && body.queuedCount != null
            ? `eventId: ${body.eventId} • queued: ${body.queuedCount}`
            : body.eventId
              ? `eventId: ${body.eventId}`
              : undefined,
      })
      await loadWebhookSubscriptions()
      return
    }

    pushToast({
      tone: "success",
      title:
        action === "rotate"
          ? "Webhook secret rotated"
          : action === "activate"
            ? "Webhook activated"
            : "Webhook deactivated",
    })
  }

  async function replayWebhookDelivery(delivery: SignalApiWebhookDelivery) {
    setWebhookBusyId(delivery.id)
    const res = await fetch("/api/admin/signal-api-webhook-deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "replay", deliveryId: delivery.id }),
    })
    const body = (await res.json()) as SignalApiWebhookDeliveryActionResponse
    setWebhookBusyId(null)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Replay failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Webhook delivery re-queued",
      description: body.eventId ? `eventId: ${body.eventId}` : undefined,
    })
    await loadWebhookSubscriptions()
  }

  async function replayFailedWebhookDeliveries(subscriptionId?: string) {
    const scopeLabel = subscriptionId ? "this subscription" : "the current webhook filter"
    if (!window.confirm(`Replay failed webhook deliveries for ${scopeLabel}?`)) return

    const busyId = subscriptionId ? `replay:${subscriptionId}` : "replay-failed"
    setWebhookBusyId(busyId)
    const res = await fetch("/api/admin/signal-api-webhook-deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "replay_failed",
        subscriptionId,
        tenantId: subscriptionId ? undefined : appliedTenantFilter.trim() || undefined,
        limit: 100,
      }),
    })
    const body = (await res.json()) as SignalApiWebhookDeliveryActionResponse
    setWebhookBusyId(null)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Bulk replay failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Failed deliveries re-queued",
      description: `${formatNumber(body.replayedCount ?? 0)} event(s) re-queued`,
    })
    await loadWebhookSubscriptions()
  }

  async function runWebhookWorker() {
    setWebhookBusyId("drain")
    const res = await fetch("/api/admin/signal-api-webhook-deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "drain", limit: 50 }),
    })
    const body = (await res.json()) as SignalApiWebhookDeliveryActionResponse
    setWebhookBusyId(null)

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Webhook worker failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Webhook worker ran",
      description: `claimed ${formatNumber(body.claimedCount ?? 0)}, delivered ${formatNumber(body.deliveredCount ?? 0)}, retried ${formatNumber(body.rescheduledCount ?? 0)}, dead-lettered ${formatNumber(body.deadLetterCount ?? 0)}`,
    })
    await loadWebhookSubscriptions()
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Signal API"
        title="Key lifecycle control"
        description="Create, rotate, revoke, and audit tenant keys for the external Apex Signal API."
        actions={
          <AdminButton
            tone="secondary"
            onClick={() => {
              void loadKeys()
              void loadQuotaPolicies()
              void loadUsage()
              void loadWebhookSubscriptions()
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </AdminButton>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Total keys" value={formatNumber(stats.total)} />
        <AdminStatCard label="Active keys" value={formatNumber(stats.active)} tone="success" />
        <AdminStatCard label="Used in 24h" value={formatNumber(stats.used24h)} tone="info" />
        <AdminStatCard
          label="Expiring in 7d"
          value={formatNumber(stats.expiresSoon)}
          tone={stats.expiresSoon > 0 ? "danger" : "default"}
        />
      </div>

      <AdminPanel
        title="Create key"
        description="Raw key material is shown once. Store it in your secret manager immediately."
      >
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" onSubmit={(event) => void createKey(event)}>
          <AdminInput
            value={createForm.tenantId}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, tenantId: event.target.value }))}
            placeholder="tenantId (required)"
          />
          <AdminInput
            value={createForm.name}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="name (required)"
          />
          <AdminInput
            value={createForm.scopes}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, scopes: event.target.value }))}
            placeholder="scopes: signals.read,ingest.write"
          />
          <AdminInput
            value={createForm.defaultUserId}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, defaultUserId: event.target.value }))}
            placeholder="defaultUserId (optional UUID)"
          />
          <AdminInput
            value={createForm.expiresDays}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, expiresDays: event.target.value }))}
            placeholder="expiresDays (optional)"
          />
          <div className="flex items-center">
            <AdminButton type="submit" disabled={createBusy}>
              {createBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create key
            </AdminButton>
          </div>
        </form>

        {revealedApiKey ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
              Raw key (visible once)
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-white px-2 py-1 text-sm text-gray-900">{revealedApiKey}</code>
              <AdminButton
                tone="secondary"
                onClick={() => {
                  void copyToClipboard(revealedApiKey).then((ok) => {
                    pushToast({
                      tone: ok ? "success" : "error",
                      title: ok ? "Copied key to clipboard" : "Clipboard copy failed",
                    })
                  })
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </AdminButton>
            </div>
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel
        title="Tenant user allowlist"
        description="If a tenant has allowlisted users, Signal API user-scoped routes only accept those user IDs."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AdminInput
            value={membershipTenantId}
            onChange={(event) => setMembershipTenantId(event.target.value)}
            placeholder="tenantId"
          />
          <AdminInput
            value={membershipUserId}
            onChange={(event) => setMembershipUserId(event.target.value)}
            placeholder="userId (UUID)"
          />
          <div className="flex gap-2">
            <AdminButton tone="secondary" onClick={() => void loadTenantUsers()}>
              {tenantUsersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Load users
            </AdminButton>
            <AdminButton disabled={tenantUsersBusy} onClick={() => void addTenantUser()}>
              {tenantUsersBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add user
            </AdminButton>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Added</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenantUsers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-gray-400">
                    No allowlisted users loaded.
                  </td>
                </tr>
              ) : (
                tenantUsers.map((user) => (
                  <tr key={user.userId}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">
                        {user.fullName ?? user.email ?? user.userId}
                      </p>
                      <p className="text-xs text-gray-500">{user.userId}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{formatDateTime(user.createdAt)}</td>
                    <td className="px-3 py-2">
                      <AdminButton
                        tone="danger"
                        className="px-2.5 py-1.5 text-xs"
                        disabled={tenantUsersBusy}
                        onClick={() => void removeTenantUser(user.userId)}
                      >
                        Remove
                      </AdminButton>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Tenant quota plans"
        description="Configure per-tenant daily/monthly API quotas and enforce plan limits."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AdminInput
            value={quotaTenantId}
            onChange={(event) => setQuotaTenantId(event.target.value)}
            placeholder="tenantId"
          />
          <AdminInput
            value={quotaPlanName}
            onChange={(event) => setQuotaPlanName(event.target.value)}
            placeholder="planName (starter, growth, scale)"
          />
          <AdminInput
            value={quotaDailyLimit}
            onChange={(event) => setQuotaDailyLimit(event.target.value)}
            placeholder="dailyLimit (blank = unlimited)"
          />
          <AdminInput
            value={quotaMonthlyLimit}
            onChange={(event) => setQuotaMonthlyLimit(event.target.value)}
            placeholder="monthlyLimit (blank = unlimited)"
          />
          <label className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={quotaEnforce}
              onChange={(event) => setQuotaEnforce(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-sky-700"
            />
            Enforce quota
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <AdminButton tone="secondary" onClick={() => void loadQuotaPolicies()}>
            {quotaLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load policies
          </AdminButton>
          <AdminButton disabled={quotaBusy} onClick={() => void saveQuotaPolicy()}>
            {quotaBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save policy
          </AdminButton>
          <AdminButton
            tone="danger"
            disabled={quotaBusy}
            onClick={() => void deleteQuotaPolicy()}
          >
            Delete policy
          </AdminButton>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Daily</th>
                <th className="px-3 py-2">Monthly</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quotaPolicies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-gray-400">
                    No quota policies found.
                  </td>
                </tr>
              ) : (
                quotaPolicies.map((policy) => (
                  <tr key={policy.tenantId}>
                    <td className="px-3 py-2 font-medium text-gray-900">{policy.tenantId}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <AdminBadge tone="info">{policy.planName}</AdminBadge>
                        {policy.enforce ? (
                          <AdminBadge tone="success">Enforced</AdminBadge>
                        ) : (
                          <AdminBadge tone="neutral">Observe</AdminBadge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatNumber(policy.dailyUsed)} / {formatLimit(policy.dailyLimit)}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatNumber(policy.monthlyUsed)} / {formatLimit(policy.monthlyLimit)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {formatDateTime(policy.updatedAt ?? policy.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <AdminButton
                          tone="ghost"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={() => applyQuotaPolicyToForm(policy)}
                        >
                          Edit
                        </AdminButton>
                        <AdminButton
                          tone="danger"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={() => void deleteQuotaPolicy(policy.tenantId)}
                        >
                          Delete
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

      <AdminPanel
        title="Webhook subscriptions"
        description="Manage tenant delivery endpoints, rotate signing secrets, and inspect recent webhook attempts."
        actions={
          <div className="flex flex-wrap gap-2">
            <AdminButton tone="secondary" onClick={() => void loadWebhookSubscriptions()}>
              {webhookLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Refresh webhooks
            </AdminButton>
            <AdminButton
              tone="secondary"
              onClick={() => triggerDownload(webhookDeliveriesCsvUrl())}
            >
              Export deliveries CSV
            </AdminButton>
            <AdminButton
              tone="secondary"
              disabled={webhookBusyId === "replay-failed"}
              onClick={() => void replayFailedWebhookDeliveries()}
            >
              {webhookBusyId === "replay-failed" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Replay failed
            </AdminButton>
            <AdminButton
              tone="secondary"
              disabled={webhookBusyId === "drain"}
              onClick={() => void runWebhookWorker()}
            >
              {webhookBusyId === "drain" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Run worker
            </AdminButton>
          </div>
        }
      >
        <form
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => void createWebhook(event)}
        >
          <AdminInput
            value={createWebhookForm.tenantId}
            onChange={(event) =>
              setCreateWebhookForm((prev) => ({ ...prev, tenantId: event.target.value }))
            }
            placeholder="tenantId"
          />
          <AdminInput
            value={createWebhookForm.name}
            onChange={(event) =>
              setCreateWebhookForm((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder="subscription name"
          />
          <AdminInput
            value={createWebhookForm.targetUrl}
            onChange={(event) =>
              setCreateWebhookForm((prev) => ({ ...prev, targetUrl: event.target.value }))
            }
            placeholder="https://example.com/webhooks/apex"
          />
          <AdminInput
            value={createWebhookForm.eventTypes}
            onChange={(event) =>
              setCreateWebhookForm((prev) => ({ ...prev, eventTypes: event.target.value }))
            }
            placeholder="signal.job_ingested,signal.outcome_recorded"
          />
          <div className="flex items-center">
            <AdminButton type="submit" disabled={createWebhookBusy}>
              {createWebhookBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create webhook
            </AdminButton>
          </div>
        </form>

        {revealedWebhookSecret ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
              Signing secret (visible once)
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-white px-2 py-1 text-sm text-gray-900">
                {revealedWebhookSecret}
              </code>
              <AdminButton
                tone="secondary"
                onClick={() => {
                  void copyToClipboard(revealedWebhookSecret).then((ok) => {
                    pushToast({
                      tone: ok ? "success" : "error",
                      title: ok ? "Copied signing secret" : "Clipboard copy failed",
                    })
                  })
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </AdminButton>
            </div>
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2">Subscription</th>
                <th className="px-3 py-2">Events</th>
                <th className="px-3 py-2">Health</th>
                <th className="px-3 py-2">Last delivery</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {webhookSubscriptions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-gray-400">
                    No webhook subscriptions configured.
                  </td>
                </tr>
              ) : (
                webhookSubscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{subscription.name}</p>
                      <p className="text-xs text-gray-500">{subscription.tenantId}</p>
                      <p className="text-xs text-gray-400">{subscription.targetUrl}</p>
                    </td>
                    <td className="px-3 py-2">
                      {subscription.eventTypes.length === 0 ? (
                        <AdminBadge tone="neutral">All events</AdminBadge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {subscription.eventTypes.map((eventType) => (
                            <AdminBadge key={`${subscription.id}:${eventType}`} tone="info">
                              {eventType}
                            </AdminBadge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {subscription.isActive ? (
                          <AdminBadge tone="success">Active</AdminBadge>
                        ) : (
                          <AdminBadge tone="danger">Disabled</AdminBadge>
                        )}
                        {subscription.latestSuccess === false ? (
                          <AdminBadge tone="warning">
                            {formatNumber(subscription.consecutiveFailures)} failures
                          </AdminBadge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {formatNumber(subscription.deliveryCount)} deliveries,{" "}
                        {formatNumber(subscription.failureCount)} failed
                      </p>
                      <p className="text-xs text-gray-400">
                        Secret {subscription.secretPrefix}...
                      </p>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      <p>{formatDateTime(subscription.lastDeliveryAt)}</p>
                      <p className="text-xs text-gray-400">
                        Last failure {formatRelativeTime(subscription.lastFailureAt, now)}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <AdminButton
                          tone="secondary"
                          className="px-2.5 py-1.5 text-xs"
                          disabled={webhookBusyId === subscription.id}
                          onClick={() => void runWebhookAction(subscription, "test")}
                        >
                          {webhookBusyId === subscription.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Test
                        </AdminButton>
                        <AdminButton
                          tone="ghost"
                          className="px-2.5 py-1.5 text-xs"
                          disabled={webhookBusyId === subscription.id}
                          onClick={() => void runWebhookAction(subscription, "rotate")}
                        >
                          Rotate secret
                        </AdminButton>
                        <AdminButton
                          tone="ghost"
                          className="px-2.5 py-1.5 text-xs"
                          disabled={webhookBusyId === `replay:${subscription.id}`}
                          onClick={() => void replayFailedWebhookDeliveries(subscription.id)}
                        >
                          {webhookBusyId === `replay:${subscription.id}` ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Replay failed
                        </AdminButton>
                        {subscription.isActive ? (
                          <AdminButton
                            tone="danger"
                            className="px-2.5 py-1.5 text-xs"
                            disabled={webhookBusyId === subscription.id}
                            onClick={() => void runWebhookAction(subscription, "deactivate")}
                          >
                            Disable
                          </AdminButton>
                        ) : (
                          <AdminButton
                            tone="secondary"
                            className="px-2.5 py-1.5 text-xs"
                            disabled={webhookBusyId === subscription.id}
                            onClick={() => void runWebhookAction(subscription, "activate")}
                          >
                            Enable
                          </AdminButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Subscription</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Queue</th>
                <th className="px-3 py-2">Attempt</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {webhookDeliveries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-gray-400">
                    No webhook deliveries recorded.
                  </td>
                </tr>
              ) : (
                webhookDeliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td className="px-3 py-2 text-gray-600">
                      <p>{formatDateTime(delivery.createdAt)}</p>
                      <p className="text-xs text-gray-400">{delivery.eventId}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      <p>{delivery.subscriptionName ?? delivery.subscriptionId}</p>
                      <p className="text-xs text-gray-400">{delivery.tenantId}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <p>{delivery.eventType}</p>
                      <p className="text-xs text-gray-400">{delivery.targetUrl}</p>
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge tone={delivery.success ? "success" : "danger"}>
                        {delivery.statusCode ?? "ERR"}
                      </AdminBadge>
                      {delivery.errorMessage ? (
                        <p className="mt-1 text-xs text-red-500">{delivery.errorMessage}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge tone={webhookQueueTone(delivery.jobStatus)}>
                        {delivery.jobStatus ?? "n/a"}
                      </AdminBadge>
                      {delivery.jobNextAttemptAt ? (
                        <p className="mt-1 text-xs text-gray-400">
                          Next {formatRelativeTime(delivery.jobNextAttemptAt, now)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      <p>{formatNumber(delivery.attemptNumber)}</p>
                      {delivery.jobMaxAttempts > 0 ? (
                        <p className="text-xs text-gray-400">
                          job {formatNumber(delivery.jobAttemptCount)} / {formatNumber(delivery.jobMaxAttempts)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{formatLatency(delivery.durationMs)}</td>
                    <td className="px-3 py-2">
                      {!delivery.success ? (
                        <AdminButton
                          tone="secondary"
                          className="px-2.5 py-1.5 text-xs"
                          disabled={webhookBusyId === delivery.id}
                          onClick={() => void replayWebhookDelivery(delivery)}
                        >
                          {webhookBusyId === delivery.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Replay
                        </AdminButton>
                      ) : (
                        <span className="text-xs text-gray-400">Delivered</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Usage and request logs"
        description="Inspect Signal API traffic, latency, errors, and recent authenticated requests."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[160px]">
              <AdminSelect
                value={usageLookbackHours}
                onChange={(event) => setUsageLookbackHours(event.target.value)}
              >
                <option value="24">Last 24 hours</option>
                <option value="168">Last 7 days</option>
                <option value="720">Last 30 days</option>
              </AdminSelect>
            </div>
            <AdminButton tone="secondary" onClick={() => void loadUsage()}>
              {usageLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Refresh usage
            </AdminButton>
            <AdminButton
              tone="secondary"
              onClick={() => triggerDownload(usageCsvUrl("recentRequests"))}
            >
              Export requests CSV
            </AdminButton>
            <AdminButton
              tone="secondary"
              onClick={() => triggerDownload(usageCsvUrl("tenants"))}
            >
              Export tenants CSV
            </AdminButton>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard
            label="Requests"
            value={formatNumber(usageSummary.totalRequests)}
            hint={appliedTenantFilter ? `Tenant ${appliedTenantFilter}` : "All tenants"}
          />
          <AdminStatCard
            label="Errors"
            value={formatNumber(usageSummary.errorRequests)}
            tone={usageSummary.errorRequests > 0 ? "danger" : "default"}
            hint={`${formatNumber(usageSummary.successRequests)} successful`}
          />
          <AdminStatCard
            label="Avg latency"
            value={formatLatency(usageSummary.avgLatencyMs)}
            tone="info"
            hint={`Across ${formatNumber(usageSummary.distinctKeys)} keys`}
          />
          <AdminStatCard
            label="Last request"
            value={formatRelativeTime(usageSummary.lastRequestAt, now)}
            hint={`${formatNumber(usageSummary.distinctTenants)} tenants active`}
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Top routes</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Route</th>
                    <th className="px-3 py-2">Requests</th>
                    <th className="px-3 py-2">Errors</th>
                    <th className="px-3 py-2">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {usageTopRoutes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-gray-400">
                        No request logs in this window.
                      </td>
                    </tr>
                  ) : (
                    usageTopRoutes.map((route) => (
                      <tr key={route.route}>
                        <td className="px-3 py-2 text-gray-700">{route.route}</td>
                        <td className="px-3 py-2 text-gray-900">{formatNumber(route.requestCount)}</td>
                        <td className="px-3 py-2 text-gray-900">{formatNumber(route.errorCount)}</td>
                        <td className="px-3 py-2 text-gray-600">{formatLatency(route.avgLatencyMs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">Active tenants</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Tenant</th>
                    <th className="px-3 py-2">Requests</th>
                    <th className="px-3 py-2">Errors</th>
                    <th className="px-3 py-2">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {usageTenants.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-gray-400">
                        No tenant activity in this window.
                      </td>
                    </tr>
                  ) : (
                    usageTenants.map((tenant) => (
                      <tr key={tenant.tenantId}>
                        <td className="px-3 py-2 font-medium text-gray-900">{tenant.tenantId}</td>
                        <td className="px-3 py-2 text-gray-900">{formatNumber(tenant.requestCount)}</td>
                        <td className="px-3 py-2 text-gray-900">{formatNumber(tenant.errorCount)}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {formatRelativeTime(tenant.lastRequestAt, now)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usageRecentRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-gray-400">
                    No recent requests recorded.
                  </td>
                </tr>
              ) : (
                usageRecentRequests.map((request) => (
                  <tr key={request.requestId}>
                    <td className="px-3 py-2 text-gray-600">
                      <p>{formatDateTime(request.createdAt)}</p>
                      <p className="text-xs text-gray-400">{request.requestId}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-900">{request.tenantId}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{request.method}</p>
                      <p className="text-xs text-gray-500">{request.route}</p>
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge tone={statusTone(request.status)}>
                        {request.status}
                      </AdminBadge>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{formatLatency(request.latencyMs)}</td>
                    <td className="px-3 py-2 text-gray-600">
                      <p>{request.apiKeyName ?? "Unknown key"}</p>
                      <p className="text-xs text-gray-400">
                        {request.apiKeyPrefix ? `${request.apiKeyPrefix}...` : request.apiKeyId ?? "n/a"}
                      </p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Keys"
        description="Filter by tenant, review usage, and run lifecycle actions."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="w-full max-w-xs">
            <AdminInput
              value={tenantFilterInput}
              onChange={(event) => setTenantFilterInput(event.target.value)}
              placeholder="Filter by tenantId"
            />
          </div>
          <AdminButton
            tone="secondary"
            onClick={() => setAppliedTenantFilter(tenantFilterInput.trim())}
          >
            Apply filter
          </AdminButton>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-sky-700"
            />
            Include inactive keys
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-3">Key</th>
                <th className="px-3 py-3">Tenant</th>
                <th className="px-3 py-3">Scopes</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Usage</th>
                <th className="px-3 py-3">Expires</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Loading keys...
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                    No keys found.
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <Fragment key={key.id}>
                    <tr className="hover:bg-gray-50/60">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-gray-900">{key.name}</p>
                        <code className="mt-0.5 block text-xs text-gray-500">{key.keyPrefix}...</code>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{key.tenantId}</td>
                      <td className="px-3 py-3">
                        {key.scopes.length === 0 ? (
                          <AdminBadge tone="neutral">All scopes</AdminBadge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.map((scope) => (
                              <AdminBadge key={`${key.id}:${scope}`} tone="info">
                                {scope}
                              </AdminBadge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {key.isActive ? (
                          <AdminBadge tone="success">Active</AdminBadge>
                        ) : (
                          <AdminBadge tone="danger">Revoked</AdminBadge>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-gray-700">{formatNumber(key.usageCount)} calls</p>
                        <p className="text-xs text-gray-500">
                          Last used {formatRelativeTime(key.lastUsedAt, now)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-gray-700">{formatDateTime(key.expiresAt)}</p>
                        <p className="text-xs text-gray-500">Created {formatDateTime(key.createdAt)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <AdminButton
                            tone="ghost"
                            className="px-2.5 py-1.5 text-xs"
                            onClick={() => startEdit(key)}
                          >
                            Edit
                          </AdminButton>
                          {key.isActive ? (
                            <AdminButton
                              tone="danger"
                              className="px-2.5 py-1.5 text-xs"
                              disabled={busyActionKeyId === key.id}
                              onClick={() => void runKeyAction(key, "revoke")}
                            >
                              {busyActionKeyId === key.id ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ShieldX className="mr-1 h-3.5 w-3.5" />
                              )}
                              Revoke
                            </AdminButton>
                          ) : (
                            <AdminButton
                              tone="secondary"
                              className="px-2.5 py-1.5 text-xs"
                              disabled={busyActionKeyId === key.id}
                              onClick={() => void runKeyAction(key, "reactivate")}
                            >
                              {busyActionKeyId === key.id ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                              )}
                              Reactivate
                            </AdminButton>
                          )}
                          <AdminButton
                            tone="secondary"
                            className="px-2.5 py-1.5 text-xs"
                            disabled={busyActionKeyId === key.id}
                            onClick={() => void runKeyAction(key, "rotate")}
                          >
                            {busyActionKeyId === key.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCw className="mr-1 h-3.5 w-3.5" />
                            )}
                            Rotate
                          </AdminButton>
                        </div>
                      </td>
                    </tr>
                    {editingKeyId === key.id ? (
                      <tr className="bg-gray-50/70">
                        <td colSpan={7} className="px-3 py-4">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <AdminInput
                              value={editDraft.name}
                              onChange={(event) =>
                                setEditDraft((prev) => ({ ...prev, name: event.target.value }))
                              }
                              placeholder="Name"
                            />
                            <AdminInput
                              value={editDraft.scopes}
                              onChange={(event) =>
                                setEditDraft((prev) => ({ ...prev, scopes: event.target.value }))
                              }
                              placeholder="Scopes (comma-separated)"
                            />
                            <AdminInput
                              value={editDraft.defaultUserId}
                              onChange={(event) =>
                                setEditDraft((prev) => ({ ...prev, defaultUserId: event.target.value }))
                              }
                              placeholder="Default user UUID (optional)"
                            />
                            <input
                              type="datetime-local"
                              value={editDraft.expiresAt}
                              onChange={(event) =>
                                setEditDraft((prev) => ({ ...prev, expiresAt: event.target.value }))
                              }
                              className="w-full rounded-2xl border border-gray-200 bg-white/95 px-3 py-2.5 text-sm text-gray-900 outline-none transition shadow-[0_8px_20px_rgba(15,23,42,0.03)] focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                            />
                          </div>
                          <div className="mt-3 flex gap-2">
                            <AdminButton disabled={editBusy} onClick={() => void saveEdit(key.id)}>
                              {editBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Save
                            </AdminButton>
                            <AdminButton tone="ghost" onClick={cancelEdit}>
                              Cancel
                            </AdminButton>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>
    </div>
  )
}
