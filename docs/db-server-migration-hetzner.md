# Moving Postgres to its own Hetzner box (for the 200k/day ramp)

Today PG shares the 4 GB web box with the Next app + MinIO — that co-location is the
root cause of the 502s/OOMs. This moves PG to a dedicated box on the Hetzner private
network, with PgBouncer in front. Target: comfortably absorb ~6M jobs/month.

## 1. The box

Hetzner **Cloud**, **same location** as the existing boxes (Hillsboro / `hil`, us-west)
so they share a private network.

| Need | Pick | Why |
|---|---|---|
| Start | **CCX33** — 8 dedicated vCPU, 32 GB RAM, 240 GB NVMe | dedicated vCPU (no noisy neighbours); 32 GB keeps the hot jobs working-set in cache |
| Headroom later | resize to **CCX43** (16 vCPU / 64 GB / 360 GB) | one-click resize, no rebuild |

Use **local NVMe** (comes with the CCX), not a Cloud Volume, for the data dir — Volumes
are network block storage and too slow for the DB hot path. If the dataset outgrows
local NVMe, resize up or move to a dedicated **AX** box (1–2 TB NVMe).

## 2. Private network (do this first)

1. Hetzner Cloud → Networks → create one (e.g. `hireoven-net`, `10.0.0.0/16`).
2. Attach **all three** servers (web, harvester, new db). Each gets a `10.0.0.x` IP.
3. Cloud Firewall on the db box: **block 5432/6432 from the public internet**; allow
   only the web + harvester private IPs. PG must never listen on its public IP.

## 3. Install on the db box (Ubuntu)

```bash
# match the CURRENT major version (check: psql -c "SHOW server_version;")
sudo apt update && sudo apt install -y postgresql-16 postgresql-contrib-16 pgbouncer
# extensions the app uses (pg_trgm for h1b-match, etc.) ship in -contrib
```

## 4. postgresql.conf (tuned for 32 GB, ingest-heavy)

```ini
listen_addresses = 'localhost,10.0.0.X'        # private IP only
max_connections = 200                           # real backends; clients pool via PgBouncer
shared_buffers = 8GB                             # ~25% RAM
effective_cache_size = 24GB                      # ~75% RAM
maintenance_work_mem = 2GB
work_mem = 64MB                                  # per sort/hash; keep modest (many ops)
random_page_cost = 1.1                           # NVMe
effective_io_concurrency = 200                   # NVMe
wal_compression = on
max_wal_size = 8GB
min_wal_size = 2GB
checkpoint_completion_target = 0.9
# High-churn jobs table (30-day retention = constant deletes) — vacuum aggressively:
autovacuum_max_workers = 4
autovacuum_vacuum_scale_factor = 0.05
autovacuum_vacuum_cost_limit = 2000
# Optional throughput-vs-durability tradeoff for an ingest pipeline (small loss window
# on crash; jobs re-ingest anyway). Decide deliberately:
# synchronous_commit = off
```

`pg_hba.conf` — allow the app + harvester over the private net only:
```
host  all  hireoven  10.0.0.0/16  scram-sha-256
```

## 5. PgBouncer (non-negotiable at this scale)

You already hit `too many clients already` this session. With many crawl workers + the
app, you must pool. `/etc/pgbouncer/pgbouncer.ini`:
```ini
[databases]
hireoven = host=127.0.0.1 port=5432 dbname=hireoven
[pgbouncer]
listen_addr = 10.0.0.X
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction          # max connection reuse
max_client_conn = 1000
default_pool_size = 40           # real backends per db (well under max_connections)
reserve_pool_size = 10
server_idle_timeout = 300
```
Apps connect to **6432** (PgBouncer), not 5432. Note: transaction mode disallows
session features (LISTEN/NOTIFY, some prepared-statement modes) — the app uses plain
pooled `pg` queries, so it's fine, but keep any LISTEN/advisory-lock code on a direct
5432 connection if it exists.

## 6. Migrate the data (short maintenance window)

Dataset is small (~905k jobs, a few GB) so a dump/restore is simplest.
```bash
# 1. quiesce writes: pause harvester crons (comment crontab) + put web app in maintenance
# 2. dump from the OLD box (parallel custom format)
pg_dump -Fc -j 4 -h <old-host> -U hireoven hireoven -f /tmp/hireoven.dump
# 3. create role + db on the NEW box, then restore (parallel)
sudo -u postgres createuser hireoven --pwprompt
sudo -u postgres createdb -O hireoven hireoven
pg_restore -j 4 -h 10.0.0.X -U hireoven -d hireoven /tmp/hireoven.dump
# 4. sanity: row counts match for jobs/companies/employer_lca_stats
psql -h 10.0.0.X -U hireoven hireoven -c "SELECT count(*) FROM jobs;"
```
For near-zero downtime later, use **logical replication** instead (subscribe the new
box to the old, cut over when caught up).

## 7. Cut over (Coolify)

1. In Coolify, update **`DATABASE_URL`** on **both** the web app and the harvester
   app-worker to: `postgres://hireoven:***@10.0.0.X:6432/hireoven` (PgBouncer port).
2. Redeploy/restart both. Verify the site + a cron run.
3. Re-enable harvester crons.
4. Keep the old PG running 24–48h as a fallback; once stable, **stop PG on the web box**
   — that reclaims its RAM for the app (and removes the contention that caused the 502s).

## 8. After it's stable (follow-ups, in order)

- **Monitor:** `pg_stat_activity`, connection counts at the pooler, autovacuum lag,
  disk %, and slow queries (`pg_stat_statements`). Wire a basic alert on disk > 80%.
- **Partition `jobs` by month** once you're at multi-million rows: retention becomes
  `DROP PARTITION` (instant) instead of a 200k-row `DELETE` (bloat + vacuum churn).
- **Backups:** nightly `pg_dump` to MinIO/object storage + test a restore. (Managed PG
  gives you this for free — reconsider Neon/Crunchy/RDS if ops time gets scarce.)
- **MinIO:** can stay on the web box for now (low contention); move only if needed.

## TL;DR
Dedicated **CCX33** on the **private network** + **PgBouncer (transaction mode)** +
the tuning above. Dump/restore cutover, point `DATABASE_URL` at `:6432`, then kill PG on
the web box. Resize to CCX43 and partition `jobs` as volume climbs.
