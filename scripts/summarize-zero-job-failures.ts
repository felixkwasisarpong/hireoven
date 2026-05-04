import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'

type Row = {
  id: string
  name: string
  domain: string
  ats_type: string
  careers_url: string
  outcome_status: string
  outcome_reason: string
  http_status: string
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function normalizeReasonGroup(reason: string): string {
  const value = reason.trim().toLowerCase()
  const curlCode = value.match(/curl:\s*\((\d+)\)/)
  if (curlCode?.[1]) return `curl_(${curlCode[1]})`
  if (value.startsWith('server_')) return 'server_5xx'
  if (value.includes('timeout')) return 'timeout'
  if (value.includes('fetch_error')) return 'fetch_error'
  if (value.includes('proxy_fetch_error')) return 'proxy_fetch_error'
  if (value.includes('ssl')) return 'ssl_error'
  if (value.includes('resolve host')) return 'dns_resolution'
  if (value.includes('connection reset')) return 'connection_reset'
  if (value.includes('http/2')) return 'http2_stream_error'
  if (value.includes('not found') || value.includes('404')) return 'not_found_404'
  if (value.includes('blocked')) return 'blocked'
  return value.slice(0, 80)
}

function normalizeDomain(row: Row): string {
  const fromField = String(row.domain ?? '').trim().toLowerCase()
  if (fromField) return fromField.replace(/^www\./, '')
  try {
    const host = new URL(String(row.careers_url ?? '').trim()).hostname.toLowerCase()
    return host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function summarize(rows: Row[]) {
  const byDomain = new Map<string, {
    count: number
    reasons: Map<string, number>
    sampleCompany: string
    sampleUrl: string
  }>()
  const byReason = new Map<string, {
    count: number
    domains: Set<string>
    sampleCompany: string
    sampleUrl: string
  }>()
  const byReasonGroup = new Map<string, {
    count: number
    domains: Set<string>
  }>()

  for (const row of rows) {
    const domain = normalizeDomain(row)
    const reason = String(row.outcome_reason ?? '').trim() || 'unknown'
    const reasonGroup = normalizeReasonGroup(reason)

    const d = byDomain.get(domain) ?? {
      count: 0,
      reasons: new Map<string, number>(),
      sampleCompany: row.name,
      sampleUrl: row.careers_url,
    }
    d.count += 1
    d.reasons.set(reason, (d.reasons.get(reason) ?? 0) + 1)
    byDomain.set(domain, d)

    const r = byReason.get(reason) ?? {
      count: 0,
      domains: new Set<string>(),
      sampleCompany: row.name,
      sampleUrl: row.careers_url,
    }
    r.count += 1
    if (domain) r.domains.add(domain)
    byReason.set(reason, r)

    const rg = byReasonGroup.get(reasonGroup) ?? {
      count: 0,
      domains: new Set<string>(),
    }
    rg.count += 1
    if (domain) rg.domains.add(domain)
    byReasonGroup.set(reasonGroup, rg)
  }

  const domainRows = [...byDomain.entries()]
    .map(([domain, data]) => {
      const topReason = [...data.reasons.entries()].sort((a, b) => b[1] - a[1])[0]
      return {
        domain,
        count: data.count,
        top_reason: topReason?.[0] ?? 'unknown',
        top_reason_count: topReason?.[1] ?? 0,
        sample_company: data.sampleCompany,
        sample_url: data.sampleUrl,
      }
    })
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))

  const reasonRows = [...byReason.entries()]
    .map(([reason, data]) => ({
      reason,
      count: data.count,
      unique_domains: data.domains.size,
      sample_company: data.sampleCompany,
      sample_url: data.sampleUrl,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))

  const reasonGroupRows = [...byReasonGroup.entries()]
    .map(([reason_group, data]) => ({
      reason_group,
      count: data.count,
      unique_domains: data.domains.size,
    }))
    .sort((a, b) => b.count - a.count || a.reason_group.localeCompare(b.reason_group))

  return { domainRows, reasonRows, reasonGroupRows }
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return `${lines.join('\n')}\n`
}

function loadCsv(path: string): Row[] {
  const raw = readFileSync(path, 'utf8')
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as Row[]
}

function main() {
  const fetchPath = process.argv[2] ?? 'scripts/output/zero-job-fetch-failures-2026-04-29.csv'
  const blockedPath = process.argv[3] ?? 'scripts/output/zero-job-blocked-failures-2026-04-29.csv'

  const fetchRows = loadCsv(fetchPath)
  const blockedRows = loadCsv(blockedPath)

  const fetchSummary = summarize(fetchRows)
  const blockedSummary = summarize(blockedRows)

  writeFileSync('scripts/output/fetch-failures-by-domain-2026-04-29.csv', toCsv(fetchSummary.domainRows))
  writeFileSync('scripts/output/fetch-failures-by-reason-2026-04-29.csv', toCsv(fetchSummary.reasonRows))
  writeFileSync('scripts/output/fetch-failures-by-reason-group-2026-04-29.csv', toCsv(fetchSummary.reasonGroupRows))
  writeFileSync('scripts/output/blocked-failures-by-domain-2026-04-29.csv', toCsv(blockedSummary.domainRows))
  writeFileSync('scripts/output/blocked-failures-by-reason-2026-04-29.csv', toCsv(blockedSummary.reasonRows))
  writeFileSync('scripts/output/blocked-failures-by-reason-group-2026-04-29.csv', toCsv(blockedSummary.reasonGroupRows))

  console.log(JSON.stringify({
    fetch_rows: fetchRows.length,
    blocked_rows: blockedRows.length,
    fetch_unique_domains: fetchSummary.domainRows.length,
    blocked_unique_domains: blockedSummary.domainRows.length,
    outputs: [
      'scripts/output/fetch-failures-by-domain-2026-04-29.csv',
      'scripts/output/fetch-failures-by-reason-2026-04-29.csv',
      'scripts/output/fetch-failures-by-reason-group-2026-04-29.csv',
      'scripts/output/blocked-failures-by-domain-2026-04-29.csv',
      'scripts/output/blocked-failures-by-reason-2026-04-29.csv',
      'scripts/output/blocked-failures-by-reason-group-2026-04-29.csv',
    ]
  }, null, 2))
}

main()
