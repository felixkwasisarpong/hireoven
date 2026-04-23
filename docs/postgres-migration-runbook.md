# PostgreSQL Cutover Runbook

This runbook moves data from Supabase Postgres into your own Postgres instance and bootstraps email-auth tables so you can migrate off Supabase-managed auth.

## 1. Prerequisites

- `pg_dump`, `pg_restore`, and `psql` installed locally.
- Source connection string from Supabase (direct Postgres connection).
- Target PostgreSQL connection string (your new Postgres host).
- App codebase checked out at a known commit.

## 2. Environment Variables

Set these in your shell when running scripts:

```bash
export SUPABASE_DB_URL='postgres://...'
export TARGET_POSTGRES_URL='postgres://...'
```

Important:
- The migration script restores with `--clean --if-exists`.
- This resets objects in `public` on the target DB.

## 3. Dump + Restore

```bash
ALLOW_TARGET_RESET=true bash scripts/db/migrate-supabase-to-postgres.sh
```

What it does:
1. Dumps `public` schema+data from Supabase.
2. Writes audit artifacts (`schema.sql` and `data.sql`) into `scripts/output/...`.
3. Creates `auth` schema/tables required for non-Supabase email auth.
4. Restores `public` schema+data into target Postgres.
5. Seeds `auth.users` from `public.profiles`.

## 4. Row Count Verification

```bash
bash scripts/db/compare-public-counts.sh
```

Review any `DIFF` or `MISSING` rows before cutover.

## 5. App Cutover Plan (Recommended Order)

1. Replace auth first:
   - Implement email magic-link/password-reset flow backed by `auth.users`, `auth.sessions`, `auth.email_tokens`.
   - Update middleware to read your own auth session cookie.
2. Replace DB access layer:
   - Move from Supabase client calls to a Postgres client/query layer.
   - Start with server API routes, then client hooks.
3. Replace file storage:
   - Move resume uploads from Supabase Storage to S3/R2/GCS (or equivalent).
4. Disable Supabase dependencies after parity:
   - Remove `@supabase/*` packages.
   - Remove Supabase env vars.

## 6. Rollback

- Keep source dump artifacts.
- Keep the old Supabase project read-only during cutover window.
- If validation fails, point app back to Supabase env and retry migration after fixes.

