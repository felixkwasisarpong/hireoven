# Moving Postgres to its own Hetzner box (for the 200k/day ramp)

> **Pre-funding? Don't buy this yet.** You already pay ~€176/mo (CPX31 €73 + CCX23
> €103). A dedicated DB box (CCX33 €166/mo) nearly doubles that — not worth it pre-
> revenue. First do the **free** wins on the existing 16 GB web box, which fix the
> actual pain (connection limits / 502s aren't a RAM problem yet):
>   1. **PgBouncer** on the web box (transaction mode) — fixes `too many clients`.
>   2. **Tune PG for 16 GB:** shared_buffers≈4GB, effective_cache_size≈11GB, aggressive
>      autovacuum (config below, halve the 32 GB numbers).
>   3. **Flip `DISCOVER_FROM_DOMAINS_ENABLED=true`** + ramp discovery *gradually* (it's
>      free — no API cost), watching load. Back off if the box strains.
> Buy the dedicated box (rest of this doc) only once monitoring shows real RAM/IOPS
> pressure AND revenue/funding supports it. Aim ~50–80k/day on current hardware first.



Today PG shares the web box (`powerful-platypus`, **CCX23 / 16 GB / 80 GB**, Ashburn
us-east, private `10.0.0.2`) with the Next app + MinIO. 16 GB has more headroom than
feared, but at ~6M jobs/month the DB still wants dedicated RAM/IOPS, and co-location
keeps app/PG/MinIO contending (the 502 + `too many clients` history). This moves PG to
its own box on the **existing** Hetzner private network, with PgBouncer in front.

Current topology:
- web: `powerful-platypus` CCX23, 16 GB, private `10.0.0.2`
- harvester: `panicky-pigeon` CPX31, 8 GB, private `10.0.0.3`
- **new db box (this doc): private `10.0.0.4`**

## 0. Interim option (go live faster, defer the split)

If you'd rather not stand up a new box right now, **resize the web box** —
**CCX23 → CCX33** (16→32 GB RAM, 80→240 GB local NVMe). One click in Hetzner Cloud
(power off → change type → power on, ~minutes). You get more RAM *and* bigger fast disk
together, no data migration.

- This is the right stopgap. It does **not** fix app/PG/MinIO contention or the single
  point of failure, and the CCX line tops out (~CCX63), so plan the split below for
  sustained 200k/day.
- **Do NOT add a Cloud Volume for the DB.** Volumes are network block storage (high
  latency) — fine for MinIO/backups/cold data, wrong for the hot jobs table. And disk
  GB is not the bottleneck; RAM/IOPS contention is.
- Hetzner caveat: the **disk upgrade is irreversible** (CPU/RAM can be downsized later,
  disk cannot).

## 1. The box (dedicated DB — the proper fix)

Hetzner **Cloud**, **Ashburn (us-east, `ash`)** — same network zone as the existing
boxes so it joins the existing private network with low latency.

| Need | Pick | Why |
|---|---|---|
| Start | **CCX33** — 8 dedicated vCPU, 32 GB RAM, 240 GB NVMe | dedicated vCPU (no noisy neighbours); 32 GB keeps the hot jobs working-set in cache |
| Headroom later | resize to **CCX43** (16 vCPU / 64 GB / 360 GB) | one-click resize, no rebuild |

Use **local NVMe** (comes with the CCX), not a Cloud Volume, for the data dir — Volumes
are network block storage and too slow for the DB hot path. If the dataset outgrows
local NVMe, resize up or move to a dedicated **AX** box (1–2 TB NVMe).

## 2. Private network (already exists — just attach)

Your boxes are already on a `10.0.0.x` private network (web `10.0.0.2`, harvester
`10.0.0.3`).
1. Create the new db box **attached to that same network** (it'll get `10.0.0.4`).
2. Cloud Firewall on the db box: **block 5432/6432 from the public internet**; allow
   only `10.0.0.2` + `10.0.0.3`. PG must never listen on its public IP.

## 3. Install on the db box (Ubuntu)

```bash
# match the CURRENT major version (check: psql -c "SHOW server_version;")
sudo apt update && sudo apt install -y postgresql-16 postgresql-contrib-16 pgbouncer
# extensions the app uses (pg_trgm for h1b-match, etc.) ship in -contrib
```

## 4. postgresql.conf (tuned for 32 GB, ingest-heavy)

```ini
listen_addresses = 'localhost,10.0.0.4'        # private IP only
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
listen_addr = 10.0.0.4
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
pg_restore -j 4 -h 10.0.0.4 -U hireoven -d hireoven /tmp/hireoven.dump
# 4. sanity: row counts match for jobs/companies/employer_lca_stats
psql -h 10.0.0.4 -U hireoven hireoven -c "SELECT count(*) FROM jobs;"
```
For near-zero downtime later, use **logical replication** instead (subscribe the new
box to the old, cut over when caught up).

## 7. Cut over (Coolify)

1. In Coolify, update **`DATABASE_URL`** on **both** the web app and the harvester
   app-worker to: `postgres://hireoven:***@10.0.0.4:6432/hireoven` (PgBouncer port).
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
