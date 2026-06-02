# Apex Signal API V1 Implementation Map

## Purpose
This document maps the external `Apex Signal API` contract to existing internal Apex services and identifies the platform gaps required to launch this as a standalone marketable product.

Primary spec: `docs/apex-signal-api-openapi-v1.yaml`

## Endpoint Mapping
| External endpoint | Internal route | Handler file | Engine/type source | Current status |
|---|---|---|---|---|
| `GET /v1/signals/market` | `/api/apex/market` | `app/api/apex/market/route.ts` | `lib/apex/market-intelligence.ts` | Implemented |
| `GET /v1/signals/company/{companyId}` | `/api/apex/company-intel/[companyId]` | `app/api/apex/company-intel/[companyId]/route.ts` | `lib/apex/company-intel/aggregator.ts` | Implemented |
| `GET /v1/signals/opportunities` | `/api/apex/opportunities` | `app/api/apex/opportunities/route.ts` | `lib/apex/opportunity-graph/generator.ts`, `lib/apex/opportunity-graph/types.ts` | Implemented |
| `GET /v1/signals/proactive` | `/api/apex/proactive` | `app/api/apex/proactive/route.ts` | `lib/apex/proactive/types.ts` | Implemented |
| `GET /v1/alerts/stream` | `/api/apex/alerts` | `app/api/apex/alerts/route.ts` | SSE stream logic in route | Implemented |
| `POST /v1/jobs/ingest` | `/api/signal/v1/jobs/ingest` | `app/api/signal/v1/jobs/ingest/route.ts` | Apex-style source dedupe + tenant-scoped raw_data matching | Implemented (API key auth) |
| `POST /v1/feedback/outcomes` | `/api/apex/outcomes` (POST) | `app/api/apex/outcomes/route.ts` | `lib/apex/outcomes/types.ts` | Implemented |

## Launch Gaps (Required Before External GA)
1. API key lifecycle management:
Admin API lifecycle routes are implemented:
`GET/POST /api/admin/signal-api-keys`, `PATCH /api/admin/signal-api-keys/{id}` (`revoke|reactivate|rotate|update`).
Admin UI is implemented at `/admin/signal-api` for list/create/rotate/revoke/update operations.
Remaining work is policy guardrails (ownership workflows, approval/audit UX).

2. Tenant isolation:
Tenant-scoped job filtering is enforced across `/api/signal/v1` signal read routes
using `raw_data->>'signalTenantId'`, and auth now prevents overriding
`default_user_id` via `x-apex-user-id`.
Optional tenant user allowlists are supported via `signal_api_tenant_users`.
Remaining work is strict tenant partitioning for non-job domain tables and final policy defaults.

3. Rate limits and product metering:
Facade now emits external rate-limit headers and writes per-request logs to
`signal_api_request_log` for authenticated `/api/signal/v1/*` traffic.
Distributed window counters are now implemented via
`signal_api_rate_limit_windows` (`scripts/migrations/add-signal-api-rate-limit.sql`)
with memory fallback in `lib/signal-api/rate-limit.ts`.
Billing-grade quota enforcement is now implemented via
`signal_api_tenant_quotas`, `signal_api_quota_daily_usage`, and
`signal_api_quota_monthly_usage` with admin controls in `/admin/signal-api`.
Remaining work is downstream billing pipeline integration (invoice/export hooks).

4. Versioned facade:
Expose `/v1/*` gateway routes that adapt to existing `/api/apex/*`.
Do not expose internal route shapes directly as public API.

5. Stable error contract:
Normalize all error payloads and statuses to one public contract.
Current route-level errors vary by endpoint.

6. Provenance metadata:
Include structured `source`, `sample_size`, `computed_at`, and `confidence_reason` fields in all signal payloads for enterprise trust.

7. Webhook subscriptions:
Tenant-managed webhook subscriptions, signing secrets, event logs, and delivery logs
are now implemented for Signal API write events.
Async delivery queueing, dead-letter replay tooling, delivery export, and a cron-safe
worker path are now implemented. Remaining work is customer self-serve webhook docs/SDKs
and long-term retention/alerting policy.

## Newly Added Foundation (This Iteration)
1. Signal API key migration:
`scripts/migrations/add-signal-api-keys.sql`

2. Key provisioning script:
`scripts/create-signal-api-key.ts`

3. Auth usage tracking:
`lib/signal-api/auth.ts` now updates `signal_api_keys.last_used_at` and `usage_count` for DB-backed keys.

4. Request-level observability:
`lib/signal-api/request-log.ts` is wired into the `/api/signal/v1/*` facade routes and inserts route/method/status/latency records into `signal_api_request_log`.

5. Tenant user access controls:
`scripts/migrations/add-signal-api-tenant-users.sql` and
`/api/admin/signal-api-tenants/{tenantId}/users` provide allowlist support for
user-scoped Signal API access.

6. Plan-linked quota enforcement:
`scripts/migrations/add-signal-api-quotas.sql` plus
`lib/signal-api/quota.ts` enforce tenant daily/monthly limits and emit
quota headers (`X-Quota-*`) on all Signal API responses.
Admin quota lifecycle route:
`GET/PUT/DELETE /api/admin/signal-api-quotas`.

7. Webhook subscriptions and deliveries:
`scripts/migrations/add-signal-api-webhooks.sql` plus
`scripts/migrations/add-signal-api-webhook-delivery-jobs.sql` plus
`lib/signal-api/webhooks.ts` add signed outbound webhook delivery for
`signal.job_ingested` and `signal.outcome_recorded`, with async queueing,
dead-letter replay, cron worker drainage, and delivery logs in `/admin/signal-api`.

## Recommended Facade Design
1. `app/api/signal/v1/*` as the public boundary.
2. Shared middleware:
`validateApiKey -> resolveTenant -> rateLimit -> requestId -> handler`.
3. Handler adapters:
Call existing Apex engines directly where possible, not via network hops.
4. Response normalizer:
Common envelope and error format.
5. Contract tests:
Schema tests against `docs/apex-signal-api-openapi-v1.yaml`.

## Security Notes
1. Keep hard-block constraints from Apex philosophy for automation claims.
2. Do not represent any signal as deterministic legal/hiring outcome.
3. Preserve cautious language in summaries and confidence values.

## 6-Week Execution Plan (Engineering)
1. Week 1:
Create `v1` gateway, API key table/schema, auth middleware, tenant context propagation.

2. Week 2:
Implement market/company/opportunity/proactive facade endpoints with shared envelope and error contract.

3. Week 3:
Implement streaming and ingestion endpoints in facade, plus external rate limiting.

4. Week 4:
Implement feedback endpoint, webhook subscriptions, signing, retries, and event logs.

5. Week 5:
Add usage metering, billing hooks, and customer-facing dashboard metrics.

6. Week 6:
Run pilot with 2-3 partners, tighten schema/SLAs, publish GA docs and SDKs.

## Packaging (Suggested)
1. Starter:
`signals.market`, `signals.company`, `signals.opportunities` with lower RPM.

2. Growth:
Adds `signals.proactive` + `alerts.stream`.

3. Scale:
Adds `jobs.ingest` + `feedback.outcomes` + webhooks + premium limits.
