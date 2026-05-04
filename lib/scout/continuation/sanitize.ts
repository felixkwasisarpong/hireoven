import type {
  ScoutContinuationState,
  ScoutResumableContext,
  ScoutResumableContextType,
} from "./types"

const MAX_RECENT_COMMANDS = 8
const MAX_CONTEXTS = 8
const MAX_COMMAND_LENGTH = 140
const MAX_ID_LENGTH = 120
const MAX_TITLE_LENGTH = 96
const MAX_MODE_LENGTH = 36

const CONTEXT_TYPES = new Set<ScoutResumableContextType>([
  "workflow",
  "compare",
  "tailor",
  "research",
  "application_queue",
])

function safeString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined
  const compact = value.replace(/\s+/g, " ").trim()
  if (!compact) return undefined
  return compact.slice(0, maxLen)
}

function safeIso(value: unknown, fallbackIso: string): string {
  if (typeof value !== "string") return fallbackIso
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return fallbackIso
  return new Date(ms).toISOString()
}

function sanitizeRecentCommands(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const dedup = new Set<string>()
  const cleaned: string[] = []

  for (const raw of value) {
    const cmd = safeString(raw, MAX_COMMAND_LENGTH)
    if (!cmd || dedup.has(cmd)) continue
    dedup.add(cmd)
    cleaned.push(cmd)
    if (cleaned.length >= MAX_RECENT_COMMANDS) break
  }

  return cleaned.length > 0 ? cleaned : undefined
}

function sanitizeResumableContexts(value: unknown, fallbackIso: string): ScoutResumableContext[] | undefined {
  if (!Array.isArray(value)) return undefined

  const byKey = new Map<string, ScoutResumableContext>()

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue

    const maybeType = safeString((raw as { type?: unknown }).type, 40)
    const type = maybeType && CONTEXT_TYPES.has(maybeType as ScoutResumableContextType)
      ? (maybeType as ScoutResumableContextType)
      : null

    if (!type) continue

    const id = safeString((raw as { id?: unknown }).id, MAX_ID_LENGTH)
    const title = safeString((raw as { title?: unknown }).title, MAX_TITLE_LENGTH)
    if (!id || !title) continue

    const updatedAt = safeIso((raw as { updatedAt?: unknown }).updatedAt, fallbackIso)
    const key = `${type}:${id}`
    const prev = byKey.get(key)

    if (!prev) {
      byKey.set(key, { type, id, title, updatedAt })
      continue
    }

    if (new Date(updatedAt).getTime() >= new Date(prev.updatedAt).getTime()) {
      byKey.set(key, { type, id, title, updatedAt })
    }
  }

  const list = [...byKey.values()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_CONTEXTS)

  return list.length > 0 ? list : undefined
}

export function sanitizeContinuationState(input: unknown, nowIso = new Date().toISOString()): ScoutContinuationState {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {}

  const state: ScoutContinuationState = {
    activeMode: safeString(src.activeMode, MAX_MODE_LENGTH),
    activeWorkflowId: safeString(src.activeWorkflowId, MAX_ID_LENGTH),
    activeJobId: safeString(src.activeJobId, MAX_ID_LENGTH),
    activeCompanyId: safeString(src.activeCompanyId, MAX_ID_LENGTH),
    activeResearchId: safeString(src.activeResearchId, MAX_ID_LENGTH),
    recentCommands: sanitizeRecentCommands(src.recentCommands),
    resumableContexts: sanitizeResumableContexts(src.resumableContexts, nowIso),
  }

  return state
}

export function isEmptyContinuationState(state: ScoutContinuationState | null | undefined): boolean {
  if (!state) return true

  return !(
    state.activeMode ||
    state.activeWorkflowId ||
    state.activeJobId ||
    state.activeCompanyId ||
    state.activeResearchId ||
    (state.recentCommands && state.recentCommands.length > 0) ||
    (state.resumableContexts && state.resumableContexts.length > 0)
  )
}

export function serializeContinuationState(state: ScoutContinuationState | null | undefined): string {
  if (!state) return ""
  return JSON.stringify({
    activeMode: state.activeMode ?? null,
    activeWorkflowId: state.activeWorkflowId ?? null,
    activeJobId: state.activeJobId ?? null,
    activeCompanyId: state.activeCompanyId ?? null,
    activeResearchId: state.activeResearchId ?? null,
    recentCommands: state.recentCommands ?? [],
    resumableContexts: (state.resumableContexts ?? []).map((ctx) => ({
      type: ctx.type,
      id: ctx.id,
      title: ctx.title,
      updatedAt: ctx.updatedAt,
    })),
  })
}

export function mergeResumableContexts(
  previous: ScoutResumableContext[] | undefined,
  next: ScoutResumableContext[] | undefined,
): ScoutResumableContext[] | undefined {
  const nowIso = new Date().toISOString()
  const merged = sanitizeResumableContexts([...(next ?? []), ...(previous ?? [])], nowIso)
  return merged
}
