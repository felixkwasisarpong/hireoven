import { isLastSeenTrustworthy } from "@/lib/jobs/last-seen-trust"
import type { ApplicationXRayJobRecord } from "../inputs"
import type {
  ApplyUrlProbeStatus,
  JobAvailabilityEvidence,
  JobIngestionPath,
} from "../types"
import type { XRayCompanyRow, XRayGhostScoreRow, XRayJobRow } from "./records"

const BOARD_CHECK_STALE_DAYS = 3

export function mapJobRecord(row: XRayJobRow, now: string): ApplicationXRayJobRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    duplicateOfId: row.duplicate_of_id,
    title: row.title,
    applyUrl: row.apply_url,
    contentHash: row.content_hash,
    availability: mapJobAvailability(row, now),
    descriptionReadable: readableDescription(row.description),
  }
}

export function mapJobAvailability(row: XRayJobRow, now: string): JobAvailabilityEvidence {
  const ingestionPath = inferIngestionPath(row)
  const trust = isLastSeenTrustworthy({
    lastSeenAt: row.last_seen_at,
    ingestionPath,
  })
  const company = row.company
  const boardLastCheckedAt = stringOrNull(company?.last_crawled_at)
  const ageDays = daysSince(row.first_detected_at, now)
  const boardCheckAge = daysSince(boardLastCheckedAt, now)

  return {
    isActive: row.is_active,
    publicationStatus: row.publication_status,
    closedAt: row.closed_at,
    closedAtReliable: Boolean(row.closed_at || row.publication_status === "hidden_expired"),
    firstDetectedAt: row.first_detected_at,
    ageDays,
    lastSeenAt: row.last_seen_at,
    lastSeenAtTrustworthy: trust.trustworthy,
    lastSeenEpochIso: row.last_seen_at,
    ingestionPath,
    boardLastCheckedAt,
    boardCheckIsStale:
      typeof boardCheckAge === "number" && boardCheckAge > BOARD_CHECK_STALE_DAYS,
    applyUrlStatus: "unknown",
    applyUrlProbedAt: null,
  }
}

export function applyCachedGhostStatus(
  record: ApplicationXRayJobRecord,
  ghost: XRayGhostScoreRow | null,
): ApplicationXRayJobRecord {
  if (!ghost) return record
  return {
    ...record,
    availability: {
      ...record.availability,
      applyUrlStatus: mapApplyUrlStatus(ghost.url_status),
      applyUrlProbedAt: ghost.last_scanned_at,
    },
  }
}

export function mapApplyUrlStatus(value: string | null | undefined): ApplyUrlProbeStatus {
  switch ((value ?? "").toLowerCase()) {
    case "live":
    case "ok":
      return "ok"
    case "dead":
      return "dead"
    case "redirect":
    case "redirects":
      return "redirect"
    default:
      return "unknown"
  }
}

export function selectSignalJob(jobRows: XRayJobRow[], requestedJobId: string): XRayJobRow | null {
  const byId = new Map(jobRows.map((row) => [row.id, row]))
  let current = byId.get(requestedJobId) ?? null
  const seen = new Set<string>()
  for (let hops = 0; current && hops <= 3; hops += 1) {
    if (!current.duplicate_of_id) return current
    if (seen.has(current.id)) return current
    seen.add(current.id)
    const next = byId.get(current.duplicate_of_id)
    if (!next) return current
    current = next
  }
  return current
}

export function companyName(company: XRayCompanyRow | null | undefined): string | null {
  return typeof company?.name === "string" && company.name.trim() ? company.name : null
}

function inferIngestionPath(row: XRayJobRow): JobIngestionPath {
  const raw = row.raw_data
  const source = [raw?.source, raw?.adapter, raw?.ingestion_path, row.source_ats]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
  if (/aggregator|adzuna|jsearch|jooble|themuse|remoteok|arbeitnow|dice/.test(source)) {
    return "aggregator"
  }
  if (/legacy|crawler/.test(source)) return "legacy_crawler"
  if (source) return "harvester"
  return "unknown"
}

function readableDescription(value: string | null): boolean {
  return Boolean(value && value.replace(/\s+/g, " ").trim().length >= 120)
}

function daysSince(value: string | null | undefined, now: string): number | null {
  if (!value) return null
  const start = Date.parse(value)
  const end = Date.parse(now)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Math.floor((end - start) / 86_400_000))
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}
