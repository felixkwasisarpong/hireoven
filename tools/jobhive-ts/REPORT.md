# jobhive-ts replica vs the hireoven harvester — head-to-head

**Goal:** weigh the power of two crawlers — the hireoven harvester (`lib/harvester/*`)
vs a faithful TypeScript port of the Python `jobhive` project
([github.com/kalil0321/ats-scrapers](https://github.com/kalil0321/ats-scrapers)) —
and decide what, if anything, to adopt from jobhive.

Everything here is reproducible from `tools/jobhive-ts/`.

---

## TL;DR

1. **On scraping, you're at parity or ahead.** On greenhouse / lever / ashby /
   smartrecruiters / recruitee the two crawlers return the *identical* job set,
   board for board. Your harvester also has 46 adapters vs jobhive's overlap of
   ~20, including government / HCM / FAANG-custom systems jobhive lacks. A full
   "rebuild in their image" would mostly re-create what you already have.

2. **The replica surfaced two real coverage bugs in your harvester:**
   - **Teamtailor: your adapter returns 0 jobs on *every* board.** It reads the
     wrong JSON key. ~1,010 companies in jobhive's dataset (plus whatever you
     already track) yield nothing. One-line fix.
   - **Workday: your adapter caps at ~1,000 jobs per tenant.** No facet
     subdivision, so big tenants are massively under-harvested. NVIDIA:
     replica **2,490** vs harvester **999** (2.5×).

3. **jobhive's real asset is its data, not its code.** Their
   company→ATS→slug dataset maps **37,004** companies you can harvest *today*
   (on adapters you already have) — a direct hit on your documented matching
   bottleneck. Import tool built, dry-run verified, ready behind `--execute`.

---

## What was built (`tools/jobhive-ts/`)

| Path | What |
|---|---|
| `src/` | Self-contained TS port of jobhive: `BaseScraper` + registry, shared `http.ts` (retry/backoff, reuses your `HARVESTER_PROXY_URL` for Workday), and 10 scrapers |
| `src/scrapers/*` | greenhouse, lever, ashby, workable, smartrecruiters, personio, recruitee, teamtailor, bamboohr, **workday (with the 2,000-cap facet subdivision)** |
| `data/*.csv` | jobhive's `ats-companies` dataset vendored locally (24 platforms, ~40k rows) |
| `benchmark.ts` | Runs BOTH crawlers over the same live boards and diffs count / overlap / description-coverage / latency. `out/benchmark.{md,json}` |
| `import-companies.ts` | Ingests the dataset via your `enrollTenantAsCompany`. Offline dry-run by default; `--check-db` (read-only) and `--execute` (writes) are opt-in |

Run:
```bash
npx tsx tools/jobhive-ts/benchmark.ts --per-ats 6
npx tsx tools/jobhive-ts/benchmark.ts --ats workday --company nvidia
npx tsx tools/jobhive-ts/import-companies.ts            # offline dry-run
```

---

## Benchmark results

Same live ATS board, both crawlers, back to back. `idOv` = jobs matched by
external-id; `titleOv` = matched by normalized title (the fair cross-crawler
metric, since the two use different id namespacing).

### Parity — both crawlers are correct and equal

| ATS | representative boards | verdict |
|---|---|---|
| greenhouse | 10a Labs 17=17, Faraday Future 66=66, VML 13=13 | **exact parity** |
| lever | 100MS 10=10, Instrumentl 24=24, PingWind 76=76 | **exact parity** |
| ashby | Ellipsis 12=12, Mind Robotics 21=21, Slope 4=4 | **exact parity** |
| smartrecruiters | Crossroads 9=9, Tidepool 1=1 | **exact parity** |
| recruitee | 12Build 19=19, neXenio 2=2, Sozialdienst 8=8 | **exact parity** |
| bamboohr | 10web 3=3, hillsmith 2=2 | parity on jobs (idOv=0 is just id-namespacing; titleOv matches) |
| workable | mostly parity; Timescapes replica 12 vs harvester 8 | ~parity, minor replica edge |
| personio | mostly parity; one board harvester 404'd, replica got it | ~parity, minor replica edge |

**Read:** your adapters are solid. The replica agreeing job-for-job is the proof.

### Divergence — the replica wins (real harvester bugs)

| ATS | board | replica | harvester | why |
|---|---|--:|--:|---|
| **teamtailor** | Fortnox AB | **18** | **0** | harvester reads wrong JSON key — see below |
| teamtailor | 1KOMMA5°, Fortnox, Let's Do This, Pontus, Technical Equip. | 13 / 18 / 2 / 5 / 8 | 0 / 0 / 0 / 0 / 0 | same bug, every board |
| **workday** | NVIDIA | **2,490** | **999** | harvester caps ~1,000; no facet subdivision |
| workday | "2020 Companies" | 1,264 | 1,000 | same cap |

---

## Bug 1 — Teamtailor adapter returns 0 on every board

`lib/harvester/adapters/teamtailor.ts:180`

```ts
const rawJobs = result.data?.jobs ?? []
```

Teamtailor's `https://{slug}.teamtailor.com/jobs.json` is **JSON Feed 1.1**:

```json
{ "version": "https://jsonfeed.org/version/1.1", "title": "Fortnox AB",
  "items": [ { "id": "...", "title": "...", "url": "...", "date_published": "..." } ] }
```

There is no `jobs` key — the array is `items`. So `result.data.jobs` is always
`undefined` → `[]`, and the adapter emits zero jobs for **every** Teamtailor
tenant, silently (no error, so it looks like an empty board). Confirmed live:
`jobs.json` returns 200 / 213 KB for `fortnoxab`, harvester maps 0.

**Fix:** read `items` and map JSON-Feed fields (`item.id`, `item.title`,
`item.url`, `item.content_html`, `item.date_published`). The replica's
`src/scrapers/teamtailor.ts` is a working reference (it uses the RSS twin
`/jobs.rss`, but the `jobs.json` `items` schema is cleaner to adopt).

## Bug 2 — Workday under-harvests big tenants by ~2.5×

`lib/harvester/adapters/workday.ts` paginates `offset += 20` until a short page.
Workday caps the *reported total* at 2,000 and silently wraps to page 1 past
that; your adapter also appears to stop near ~1,000. Either way big tenants are
truncated.

jobhive's fix (ported in `src/scrapers/workday.ts`): when a query reports exactly
2,000, **subdivide by a facet** (`jobFamilyGroup` → `timeType` → `locations` →
`workerSubType`); each child query has its own ≤2K cap and dedup absorbs overlap.
Result on NVIDIA: **2,490 vs 999**. On a tenant like Accenture (~60k) the gap is
an order of magnitude.

**Fix:** port the `exhaust` / `pickFacet` logic into your adapter. It's ~120
lines and self-contained. Keep routing Workday through `HARVESTER_PROXY_URL`
(the residential proxy) — the subdivision multiplies request volume.

---

## Benchmarking proxy-routed adapters (Workday, Workable, …)

Some adapters must egress through the residential proxy (`HARVESTER_PROXY_URL`)
because the ATS WAF 403/429s the datacenter IP — Workday (`myworkdayjobs.com`)
and Workable (`apply.workable.com`, added to `HARVESTER_PROXY_HOSTS` in prod).
To compare those *fairly*, the replica must egress through the same proxy, or it
just gets blocked while the harvester (on a clean IP) succeeds.

The replica supports this two ways:

- **Same env** — `src/http.ts` reads the *same* `HARVESTER_PROXY_URL` +
  `HARVESTER_PROXY_HOSTS` with the *same* host-suffix matching as the harvester,
  so setting those envs routes both sides through the proxy.
- **`--shared-transport`** — routes the replica through the harvester's actual
  `harvesterFetch` (same ProxyAgent, same keep-alive), so the *only* difference
  measured is parsing, not which IP got blocked. This is the mode to use when
  validating a proxy-dependent adapter.

```bash
# both sides egress through the proxy; replica uses the harvester's transport
HARVESTER_PROXY_URL='http://user:pass@residential.proxy:8000' \
HARVESTER_PROXY_HOSTS='myworkdayjobs.com,apply.workable.com,jobs.workable.com' \
  npx tsx tools/jobhive-ts/benchmark.ts --ats workday,workable --per-ats 4 --shared-transport
```

A **preflight** prints before every run: proxy on/off, the direct-vs-proxy egress
IP (so you can confirm the proxy is actually taking effect — `✓ distinct`), and
which of the sampled ATS are being routed through it. That makes proxy-routed
comparisons trustworthy instead of silently-blocked.

## jobhive's dataset — the strategic win

Their `ats-companies/*.csv` is a company→ATS→slug map. Filtered to ATS your
harvester already supports, the offline dry-run
(`import-companies.ts`) yields:

```
TOTAL importable   37,004   across 19 supported platforms
  bamboohr 5,632 · greenhouse 4,966 · workable 4,269 · ashby 2,856 ·
  jazzhr 2,689 · workday 2,571 · personio 2,463 · smartrecruiters 2,214 ·
  lever 2,113 · rippling 1,923 · icims 1,363 · successfactors 1,271 ·
  teamtailor 1,010 · recruitee 888 · oracle 442 · taleo 150 · avature 87 ·
  phenom 85 · eightfold 12

Unsupported (no adapter) — 2,841 NOT importable:
  breezy 1,384 · gem 496 · pinpoint 350 · recruiterbox 314 · cornerstone 297
```

The import routes every row through your own `enrollTenantAsCompany`, so dedup
(by ats pair, then domain) and harvest-queueing are identical to organic
discovery — overlap with companies you already have is absorbed, not duplicated.
This directly attacks the documented bottleneck ("50k/day lever is ATS-matching,
not cadence; ~18.4k unmatched"): 37k pre-resolved matches, no probing required.

**Two secondary findings from the import:**
- **5 net-new ATS platforms** (breezy, gem, pinpoint, recruiterbox, cornerstone
  = 2,841 companies) your harvester can't crawl at all — candidates for new
  adapters. Breezy alone is 1,384 companies.
- 92 rows skipped on normalization (unparseable Workday/Oracle URLs) — noise.

### Recommended landing

1. `npx tsx tools/jobhive-ts/import-companies.ts --check-db` — read-only,
   one indexed query per ats_type, prints true net-new vs already-present.
   (Respects the "no heavy scans on the web box" rule — no full-table scan.)
2. Review the net-new count, then `--execute` off-peak. **`df -h` the web box
   first** — 37k inserts is modest but the disk is ~75% full per your notes.
   Consider `--ats greenhouse --limit 500` for a first canary batch.

---

## Verdict

- **Don't rebuild your crawler in jobhive's image** — you'd lose adapters and
  gain nothing on the platforms that matter. On scraping you're at parity or
  ahead.
- **Do take three concrete things:**
  1. Fix the Teamtailor `items` key (unlocks a whole ATS that's currently 0).
  2. Port the Workday facet subdivision (2.5×–10× on big tenants).
  3. Import the 37k-company dataset (fills the matching gap directly).
- **Optionally** add adapters for breezy / gem / cornerstone / pinpoint /
  recruiterbox (~2.8k more companies).

The replica earned its keep not by beating your crawler broadly, but by acting
as a differential oracle that exposed two silent coverage bugs you'd otherwise
never see — both boards just looked "empty."
