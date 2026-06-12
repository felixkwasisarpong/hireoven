-- Cursor for the phase-2 browser-render ATS resolver
-- (scripts/discover-from-domains-render.ts). Mirrors careers_discovery_attempted_at
-- / ats_probe_attempted_at: set when the render resolver has tried a company so
-- repeat runs don't re-render the same misses. Nullable, no default → instant
-- metadata-only add on the companies table.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS render_resolve_attempted_at TIMESTAMPTZ;
