# Daily Shortlist — specification

A consumer of Application X-Ray. Answers **"of everything open to me right now,
which few should I actually apply to today, and why not the rest."**

This is a milestone *after* the X-Ray pure core, and it imposes one requirement
on that core (§4). Nothing here changes the X-Ray contract's semantics; it
changes how the engine is invoked and adds a surface.

Companions: `product-contract.md`, `decision-table.md`, `xray-contract.ts`.

---

## 1. The promise

> Skim everything, surface the few worth the effort, and account for the rest.

The behaviour being productised is a real workflow: the user browses the feed,
then asks an assistant to read the jobs and pick which to apply to — because
**a good match score is not the same as a good application**. A role can score
85 and still be a waste: the posting bars sponsorship, it wants a licence the
user doesn't hold, it's been open 120 days, or the résumé doesn't evidence the
one thing the screen is looking for.

X-Ray already answers that per job. The shortlist runs it over a set.

### 1.1 What it must not claim

The originating request included *"or it falls through at recruiter stage."*

**The shortlist cannot predict recruiter behaviour, and must not imply it can.**
That is an outcome prediction. There is no calibrated outcome data — the
`application_timing_signals` recompute is still outstanding — and
`product-contract.md` §6.3 prohibits numeric interview probability outright.

What it *can* do is remove applications that are knowably not worth sending:
explicit requirement conflicts, confirmed-absent mandatory requirements,
corroborated capability mismatch, definitively closed postings, and unreadable
or misaimed résumés. That is most of the "why was I auto-rejected" surface, and
it is honest.

Permitted framing: *"here's what is knowably not worth your time today."*
Prohibited framing: *"you'd get past the recruiter on these."*

---

## 2. Why Apex, and not Watchlist

Established by inspection:

| Surface | What it actually is | Verdict |
| --- | --- | --- |
| `watchlist` | `watchlist(user_id, company_id)` — company following. No concept of a job, let alone a judgment about one. | **Input only.** Followed companies contribute to the candidate set. Unchanged otherwise. |
| Apex | Already owns "what should I do today": `lib/apex/hunt/planner.ts`, `today-plan-state`, the application queue, auto-apply. | **Host.** The output of triage is an action, and actions live here. |

There is also an existing seam. `lib/apex/opportunity-rerank.ts` already detects
the exact phrasing — *re-rank / prioritise / triage … opportunities*, and
`"deserves attention today"* — but `app/api/apex/chat/route.ts:415` resolves it
to an `APPLY_FILTERS` action, i.e. **a search chip**. The user asks "which should
I apply to" and receives "here are more jobs". The intent detector is right; the
thing behind it is missing. This spec is that thing.

---

## 3. Candidate set

Built once per run, from existing published-visibility predicates. No new
crawling, no new enrichment.

**Included**

1. Feed-visible jobs for the user (same predicates as `app/api/match/feed`:
   `sqlPublishedJob`, active, location rules), `first_detected_at` within the
   freshness window (default 14 days).
2. Saved jobs not yet applied (`job_applications.status = 'saved'`), at any age
   — the user already flagged intent.
3. Open jobs at watchlisted companies, within the window.

**Excluded**

- Anything with a `job_applications` row at `applied` or beyond.
- Anything the user dismissed from a previous shortlist (§7.3).
- Duplicates — resolved to canonical first (X-Ray stage A), then deduped by
  `evaluatedJobId`, so a job reachable three ways is triaged once.

**Bounded.** Hard cap (default 200) applied by existing feed ordering *before*
any X-Ray work. If the cap truncates, the run says so — silent truncation reads
as "we looked at everything" when we didn't.

---

## 4. Deterministic batch mode — the core requirement

**This is the one thing that must land in the X-Ray core, not be retrofitted.**

X-Ray as specified is a detail-page engine: it probes apply URLs on a 5s
timeout, queries the networking finder (four parallel queries), and may call an
LLM. Running that across 200 jobs would issue ~200 outbound HTTP probes and ~800
network-contact queries per user per day. The web box has previously been
OOM-restarted by far less.

So the engine must expose an execution mode:

```
mode: "detail" | "batch"
```

`batch` guarantees:

| Forbidden in batch | Consequence |
| --- | --- |
| `probeApplyUrl` | `applyUrlStatus = "unknown"` — already a legal value, already produces no penalty |
| Networking finder | `accessRoutes = []`, so **`FIND_ACCESS` is unreachable in batch**. Those jobs surface as `APPLY_NOW`; the route is discovered on the detail view. Stated in the output, not hidden. |
| Any LLM call | All requirement strengths cap at `INFERRED`; no LLM-phrased headlines |
| Per-job outbound HTTP | — |
| Uncached ghost recompute | Cached score used; absent cache ⇒ `band = "unknown"` |

Everything `batch` *may* read is already cached or local: `jobs` / `companies`
rows, `job_match_scores.score_breakdown` (subject to `isScoreFreshForResume`),
`ghost_job_scores`, `company_health_scores`, the parsed résumé, and posting text.

**`XRaySummary` must be fully computable in `batch` mode.** That is the
acceptance test for this requirement.

### 4.1 Two passes, because Evidence and Positioning are the expensive local work

`buildLocalTailorAnalysis` and `buildPositioningBrief` are pure but do real
string work per job. At 200 jobs that is meaningful CPU on a shared box, and
most of it is wasted on jobs that were never going to survive.

```
Pass 1  — all N jobs      Hiring Reality · Capability · Eligibility
                          (stages A, B, C, E — all cheap, all cached)
                          → drop CLOSED, explicit conflicts, corroborated mismatches

Pass 2  — survivors only  Evidence · Positioning
                          (stages D, F, G, I)
                          → final action, ranking
```

Typical shape: 200 in, ~30–50 survive pass 1, ~10–15 reach `APPLY_NOW`.

Pass 1 must never emit a *final* action other than `SKIP`. A job that survives
pass 1 has not been approved — it has merely not been eliminated. The
distinction matters because pass-1 output is what gets cached for the "why not"
list.

---

## 5. Ranking within `APPLY_NOW`

Only `APPLY_NOW` jobs are ranked. The others are grouped, not ordered.

**`job_match_scores.overall_score` must not be the sort key.** It folds a
sponsorship rank delta (`computeFastScore`), so ranking by it re-introduces the
double-count X-Ray exists to remove, and would order a sponsorship-needing
user's day by their immigration status.

Sort, in order:

1. **Window** — `hot` (≤48h) before `open` (≤7d) before `aging`. Applying early
   is the one timing lever with repository support, and a fresh posting is
   perishable in a way an old one is not.
2. **Capability band** — `EXCEEDS`, `MEETS`, `NEAR_MISS`.
3. **Evidence band** — `STRONG`, `ADEQUATE`, `BURIED`.
4. **Confidence** — `high`, `medium`, `low`.
5. **Stable tiebreak** — `evaluatedJobId` ascending. No randomness; two runs over
   unchanged inputs produce identical order.

Ranking is presentational. It never changes a band or a final action.

### 5.1 Daily volume guard

The shortlist is capped (default 10, user-configurable). Beyond the cap, jobs
stay in a "more that qualify" tail rather than being dropped — the cap is about
attention, not eligibility.

A day where nothing qualifies returns **an empty shortlist with the reasons**,
never a padded list. Padding is how a triage tool becomes noise: if the honest
answer is "nothing today", saying so is the product working.

---

## 6. The "why not" account

Every candidate that didn't make the shortlist is accounted for, grouped by the
**stage that eliminated it** — not by rule id, which is an implementation
detail.

| Group | From | Copy shape |
| --- | --- | --- |
| No longer open | `RB1` | "3 postings have closed" |
| Conflicts with what you've told us | `RC1`, `RC2`, `RC3` | "5 require something you've said you don't have" |
| Not enough to judge | `RD1`, `RD2` | "2 need an answer from you first" |
| Different lane | `RE1` | "8 are a different kind of role" |
| Would need work first | `RE2`–`RG2` | "6 need a résumé change before they're worth sending" |

Each group expands to the individual jobs, each carrying its own X-Ray
`headline`. The account is the trust mechanism: a shortlist that only shows
winners is indistinguishable from a shortlist that lost things.

**"Would need work first" is the actionable group** — those are the
`STRENGTHEN_FIRST` jobs, and each one already knows its repair and whether it
fits the posting's window.

---

## 7. Attachment points in Apex

### 7.1 Engine

`lib/application-xray/shortlist.ts` — pure. Takes an already-loaded candidate
set plus a batch-mode X-Ray runner; returns the ranked shortlist and the grouped
account. No I/O, so it is unit-testable, per repo convention.

### 7.2 Route and cadence

`app/api/apex/shortlist/route.ts`. Computed **once per user per day** and
snapshotted; re-reads are free. Recompute triggers: résumé version change
(`isScoreFreshForResume`), explicit refresh, or the daily roll.

The snapshot is what the user acted on. It is never silently mutated — a
recompute is a new snapshot, consistent with the post-apply immutability rule in
`product-contract.md` §10.

### 7.3 Dismissal

Dismissing a shortlist entry excludes that `evaluatedJobId` from future
candidate sets for a period (default 30 days), and records the reason when the
user gives one. This is the only user-supplied signal in the loop; it is *not*
outcome data and must not be fed to any scoring path.

### 7.4 Chat intent — reuse, don't rebuild

`extractOpportunityRerankTarget` already fires on the user's natural phrasing.
Change what it resolves to:

| Today | After |
| --- | --- |
| `APPLY_FILTERS` → a search chip | `SHOW_SHORTLIST` → the ranked list with reasons |

Keep the role-target extraction — "triage my backend roles" should scope the
candidate set to that lane rather than ignoring it. `SET_FOCUS_MODE` behaviour
is unchanged.

### 7.5 Relationship to the hunt queue

`ApexHuntQueueItem` already carries `queueScore` and `reason`, and
`hunt/planner.ts` already builds a queue. The shortlist does **not** replace it:
the hunt plan is strategy ("which lanes to attack this week"), the shortlist is
triage ("which of today's openings to send"). Shortlist output may *feed* the
queue; it must not duplicate the planner.

---

## 8. Performance budget

Per user per day, one run:

| Resource | Budget |
| --- | --- |
| Outbound HTTP | **0** |
| Networking-contact queries | **0** |
| LLM calls | **0** |
| DB queries | One bounded candidate query + batched cache reads. No unindexed predicate, no full-table scan on `jobs`. |
| Pass-2 jobs | Survivors only, ≤ 60 |

The zero-HTTP guarantee is the one that keeps this deployable on the current
box, and it is why `FIND_ACCESS` is deliberately unreachable in batch.

---

## 9. Test obligations

1. `XRaySummary` computes fully in `batch` mode for every fixture in
   `test-fixtures.md` that doesn't depend on a probe, a route, or an LLM.
2. Batch mode issues zero outbound HTTP and zero networking queries — asserted
   by injecting throwing stubs.
3. Determinism: same candidate set + same snapshot inputs ⇒ identical order and
   identical grouping across 100 runs with shuffled input order.
4. Ranking never reads `overall_score` — asserted by toggling
   `needs_sponsorship` on two otherwise-identical users and requiring identical
   shortlist order.
5. Every non-shortlisted candidate appears in exactly one account group; counts
   sum to the candidate-set size minus the shortlist.
6. An empty shortlist still returns a populated account.
7. Truncation by the candidate cap is reported, never silent.
8. A duplicate and its canonical produce one entry, not two.

---

## 10. Sequencing

| Milestone | Depends on |
| --- | --- |
| X-Ray pure core, **including `mode: "batch"`** | — |
| `lib/application-xray/shortlist.ts` + tests | core |
| `app/api/apex/shortlist/route.ts` + snapshot | shortlist engine |
| Chat intent rewiring (§7.4) | route |
| Surface in Apex | route |

The only item that must be folded into the current Codex prompt is
**`mode: "batch"` and the `XRaySummary`-computable-in-batch guarantee** (§4).
Everything else is additive and can follow.

---

## 11. Open questions

1. **Freshness window default.** 14 days is a guess. It should be tuned against
   how much of the user's feed is actually fresh on a normal day.
2. **Does the shortlist include `STRENGTHEN_FIRST` jobs whose repair is
   minutes?** Argument for: a 20-minute fix on a hot posting is worth doing
   today. Argument against: the shortlist should be things to *send*, not things
   to *work on*. Recommend keeping them in the account with a "quick fix" flag,
   and revisiting once there's usage.
3. **Per-lane shortlists.** "Triage my backend roles" scopes the set; whether
   the daily snapshot is per-lane or global needs a product call.
