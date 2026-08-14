# Application X-Ray — fresh calibration, human baseline

**Fill this in before any X-Ray output is generated or shown.** That is the whole point: a baseline
recorded after seeing the machine's answer is not a baseline.

## Integrity

| | |
| --- | --- |
| `blind-pack.json` SHA-256 | `718b69410221133ec7bc162142e608f24125f23b8a716d1d4480aabfb1d0a678` |
| Pack generated | 2026-08-14T20:56:52.000Z |
| Source | production `5.161.53.248` / `hireoven`, read-only |
| X-Ray called during selection | **No** |

Verify the pack is unmodified before recording results:

```bash
shasum -a 256 docs/application-xray/fresh-calibration/blind-pack.json
```

## Candidate

| Field | Value |
| --- | --- |
| userId | `6ab1784e-1d7f-4908-9725-82d4a69c400f` |
| resumeId | `2d5aed28-4bac-4e83-a877-65b5dc67e47b` |
| resumeVersion | `1786656925` |
| résumé content SHA-256 | `cbbe334f17999ec571c209223baae74e9d8cd805d9baff1edb7525388db8bcc3` |
| parse status | complete |
| **visa_status** | **opt** |
| **work_authorization** | **opt** |
| **needs_sponsorship** | **True** |
| **opt_end_date** | **2027-02-14** |
| authorization conflicts | none — profiles and autofill_profiles agree |

> The production `opt_end_date` is **2027-02-14**. Earlier historical runs were frozen against the local
> snapshot, which carried **2026-09-03**. Roughly seventeen months of difference in runway, so any
> intuition carried over from that exercise about urgency should be set aside.

## Coverage

| Category | Selected |
| --- | --- |
| A — Strong backend / fintech alignment | 8 |
| B — Backend + AI/ML bridge | 4 |
| C — Staff / platform / AI stretch | 4 |
| D — Authorization-language cases | 5 |
| E — Fresh but incomplete or questionable | 4 |
| F — actionable access route | **0 — not exercisable** |

Age windows: **0-7d** 8, **8-21d** 9, **22-45d** 8 · ATS types: **15**

### Why there are no FIND_ACCESS cases

Felix has 38 linkedin_connections in production, all with profile URLs, but at only two companies (OneSignal, Baystate Health). OneSignal has no fresh qualifying job. Baystate's only fresh qualifying job is a Nurse Resident role, which is outside the resume's lane entirely — including it would manufacture a FIND_ACCESS case rather than observe one. cohort_members and employer_cohort_requests are both empty for this user. The two slots were redistributed to categories A and E.

**FIND_ACCESS is NOT EXERCISABLE from production data for this candidate.**

## Freshness preflight

| Window | Qualifying jobs |
| --- | --- |
| 0-7d | 14,305 |
| 8-21d | 19,935 |
| 22-45d | 25,760 |

Gates applied:

- is_active = true
- publication_status not in (hidden_invalid, hidden_low_quality, hidden_duplicate, hidden_expired)
- duplicate_of_id IS NULL (canonical resolution succeeds; all 25 resolve to themselves)
- job-specific title (department/navigation titles excluded)
- apply_url present and non-empty
- last_seen_at within 14 days
- description length >= 400 (relaxed for category E, which tests thin content deliberately)

`posted_at` is not trusted for age: it is NULL on 8 of 25 rows and later than `first_detected_at` on 4 more.
Trustworthy age is derived from `first_detected_at` throughout, and each job records its own anomaly.

---

## The 25 jobs

### 1. Senior Software Engineer - Backend - Card & Transaction Platform *EU/UK remote* (m/f/d)

**Company:** pliant-therapeutic  
**Category:** A — Strong backend / fintech alignment  
**ATS:** ashby  
**Age:** 0d (0-7d)  
**postedAt:** `2026-08-14T15:46:09.241+00:00` · **firstDetectedAt:** `2026-08-14T15:46:09.241+00:00` · **lastSeenAt:** `2026-08-14T19:09:24.13+00:00`  
**jobId:** `4ceb0136-2b98-433f-80e5-f0472221b4c1` · **canonical:** `4ceb0136-2b98-433f-80e5-f0472221b4c1`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `jobs.ashbyhq.com`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** no structural concerns noted

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 2. Senior Software Engineer (Java / Kotlin)

**Company:** Runa  
**Category:** A — Strong backend / fintech alignment  
**ATS:** ashby  
**Age:** 0d (0-7d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-08-14T03:40:18+00:00` · **lastSeenAt:** `2026-08-14T12:01:23.660211+00:00`  
**jobId:** `b83a5174-ccaf-4aac-a7e2-328f9ba82275` · **canonical:** `b83a5174-ccaf-4aac-a7e2-328f9ba82275`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `www.arbeitnow.co.uk`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** posted_at is NULL — age derived from first_detected_at only

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 3. Consultant, Software Engineer

**Company:** Nationwide  
**Category:** A — Strong backend / fintech alignment  
**ATS:** workday  
**Age:** 0d (0-7d)  
**postedAt:** `2026-08-14T08:17:03.077+00:00` · **firstDetectedAt:** `2026-08-14T08:17:03.077+00:00` · **lastSeenAt:** `2026-08-14T08:17:03.077+00:00`  
**jobId:** `c0937136-1661-47ba-a35f-2d32a7f834ed` · **canonical:** `c0937136-1661-47ba-a35f-2d32a7f834ed`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `nationwide.wd1.myworkdayjobs.com`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** no structural concerns noted

> Authorization language: “ This role does not qualify for employer sponsored work authorization”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 4. Analyst, SW Full Stack Eng

**Company:** Ntrs  
**Category:** A — Strong backend / fintech alignment  
**ATS:** workday  
**Age:** 0d (0-7d)  
**postedAt:** `2026-08-14T05:27:54.718+00:00` · **firstDetectedAt:** `2026-08-14T05:27:54.718+00:00` · **lastSeenAt:** `2026-08-14T05:27:54.718+00:00`  
**jobId:** `26c123c7-3dbd-4aee-9894-688bc92cb086` · **canonical:** `26c123c7-3dbd-4aee-9894-688bc92cb086`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `ntrs.wd1.myworkdayjobs.com`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** no structural concerns noted

> Authorization language: “ Work Authorization Applicants must be authorized to work in the U”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 5. Sr Engineer, Software Engineer - Java

**Company:** Nationwide  
**Category:** A — Strong backend / fintech alignment  
**ATS:** workday  
**Age:** 1d (0-7d)  
**postedAt:** `2026-08-14T08:17:03.077+00:00` · **firstDetectedAt:** `2026-08-13T14:19:40.436+00:00` · **lastSeenAt:** `2026-08-14T08:17:03.077+00:00`  
**jobId:** `bc9588f0-8fd9-4bdd-a9fc-a5e35206ff38` · **canonical:** `bc9588f0-8fd9-4bdd-a9fc-a5e35206ff38`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `nationwide.wd1.myworkdayjobs.com`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** posted_at anomaly: posted_at AFTER first_detected_at — age derived from first_detected_at

> Authorization language: “ - Experience with Python is nice to have This role does not qualify for employer-sponsored work authorization”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 6. Software Engineer - AI Experience *Remote* (m/f/d)

**Company:** pliant-therapeutic  
**Category:** A — Strong backend / fintech alignment  
**ATS:** ashby  
**Age:** 3d (0-7d)  
**postedAt:** `2026-08-11T12:06:06.98+00:00` · **firstDetectedAt:** `2026-08-11T12:06:06.98+00:00` · **lastSeenAt:** `2026-08-14T19:09:24.13+00:00`  
**jobId:** `a29df389-9971-458b-8ae5-32842e48dad5` · **canonical:** `a29df389-9971-458b-8ae5-32842e48dad5`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `jobs.ashbyhq.com`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** no structural concerns noted

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 7. Software Engineer/Developer - Contingent

**Company:** Aretum  
**Category:** A — Strong backend / fintech alignment  
**ATS:** workable  
**Age:** 4d (0-7d)  
**postedAt:** `2026-08-10T00:00:00+00:00` · **firstDetectedAt:** `2026-08-10T00:00:00+00:00` · **lastSeenAt:** `2026-08-14T20:50:10.995+00:00`  
**jobId:** `0dbb971a-6eff-44dc-b91f-10204f597339` · **canonical:** `0dbb971a-6eff-44dc-b91f-10204f597339`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `apply.workable.com`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** no structural concerns noted

> Authorization language: “ccessful award of the associated contract to Aretum and completion of any required background investigation or security clearance verification”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 8. Senior AI Software Engineer | AI Agents | Python | F2F Interview in NJ - W2 Role

**Company:** Tmsllc  
**Category:** A — Strong backend / fintech alignment  
**ATS:** smartrecruiters  
**Age:** 7d (0-7d)  
**postedAt:** `2026-08-07T18:05:23.285+00:00` · **firstDetectedAt:** `2026-08-07T18:05:23.285+00:00` · **lastSeenAt:** `2026-08-14T07:48:01.839+00:00`  
**jobId:** `32f602ef-e83d-4e24-af31-fb3e786eb7d1` · **canonical:** `32f602ef-e83d-4e24-af31-fb3e786eb7d1`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `jobs.smartrecruiters.com`)  
**Why selected:** Backend with payments/banking domain language — closest alignment to the resume.  
**Description notes:** no structural concerns noted

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 9. Lead AI Engineer

**Company:** All Your BI  
**Category:** B — Backend + AI/ML bridge  
**ATS:** recruitee  
**Age:** 8d (8-21d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-08-06T17:20:14+00:00` · **lastSeenAt:** `2026-08-07T12:01:39.738227+00:00`  
**jobId:** `bd7f53ed-5428-4b49-afb7-ec0328cef5d9` · **canonical:** `bd7f53ed-5428-4b49-afb7-ec0328cef5d9`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `www.arbeitnow.com`)  
**Why selected:** AI/ML role with backend or Python foundations — bridges the resume's engineering depth and its AI work.  
**Description notes:** posted_at is NULL — age derived from first_detected_at only

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 10. Applied Scientist, Amazon Connect Talent

**Company:** Ring & DuChateau Consulting Engineers  
**Category:** B — Backend + AI/ML bridge  
**ATS:** amazon  
**Age:** 13d (8-21d)  
**postedAt:** `2026-08-01T00:00:00+00:00` · **firstDetectedAt:** `2026-08-01T00:00:00+00:00` · **lastSeenAt:** `2026-08-01T12:28:16.142+00:00`  
**jobId:** `92fc8b47-730e-4f20-b6f4-09ba18cf516d` · **canonical:** `92fc8b47-730e-4f20-b6f4-09ba18cf516d`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `www.amazon.jobs`)  
**Why selected:** AI/ML role with backend or Python foundations — bridges the resume's engineering depth and its AI work.  
**Description notes:** last_seen_at is 13d old

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 11. Senior AI Engineer | Colombia

**Company:** Go Cadre  
**Category:** B — Backend + AI/ML bridge  
**ATS:** gem  
**Age:** 17d (8-21d)  
**postedAt:** `2026-07-28T16:09:28+00:00` · **firstDetectedAt:** `2026-07-28T16:09:28+00:00` · **lastSeenAt:** `2026-08-14T16:01:13.047+00:00`  
**jobId:** `8ad925ff-6c47-448f-9071-89f3709d0748` · **canonical:** `8ad925ff-6c47-448f-9071-89f3709d0748`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `jobs.gem.com`)  
**Why selected:** AI/ML role with backend or Python foundations — bridges the resume's engineering depth and its AI work.  
**Description notes:** no structural concerns noted

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 12. Sr. Applied Scientist, Silicon and Systems Group Edge AI, Edge AI Platform

**Company:** Amazon  
**Category:** B — Backend + AI/ML bridge  
**ATS:** amazon  
**Age:** 21d (8-21d)  
**postedAt:** `2026-07-24T00:00:00+00:00` · **firstDetectedAt:** `2026-07-24T00:00:00+00:00` · **lastSeenAt:** `2026-08-14T19:43:24.978+00:00`  
**jobId:** `536645c4-3d45-482f-aaba-aca2e8b088ae` · **canonical:** `536645c4-3d45-482f-aaba-aca2e8b088ae`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `www.amazon.jobs`)  
**Why selected:** AI/ML role with backend or Python foundations — bridges the resume's engineering depth and its AI work.  
**Description notes:** no structural concerns noted

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 13. Senior Staff Software Engineer, Generative AI, Search Intelligence

**Company:** Google  
**Category:** C — Staff / platform / AI stretch  
**ATS:** google  
**Age:** 22d (22-45d)  
**postedAt:** `2026-07-24T01:33:50.307+00:00` · **firstDetectedAt:** `2026-07-23T01:55:08.987+00:00` · **lastSeenAt:** `2026-08-14T02:06:15.021+00:00`  
**jobId:** `dd99db95-eeb8-4fa5-9303-20f8b0490dc1` · **canonical:** `dd99db95-eeb8-4fa5-9303-20f8b0490dc1`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `www.google.com`)  
**Why selected:** Staff/principal/architect level — a genuine level stretch.  
**Description notes:** posted_at anomaly: posted_at AFTER first_detected_at — age derived from first_detected_at

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 14. Principal Engineer - Platform Architecture & Transformation

**Company:** Conexiom  
**Category:** C — Staff / platform / AI stretch  
**ATS:** jobvite  
**Age:** 29d (22-45d)  
**postedAt:** `2026-08-14T08:16:23.984+00:00` · **firstDetectedAt:** `2026-07-16T00:00:00+00:00` · **lastSeenAt:** `2026-08-14T08:16:23.984+00:00`  
**jobId:** `80265af1-0af6-4db7-ad11-f9eb18899e01` · **canonical:** `80265af1-0af6-4db7-ad11-f9eb18899e01`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `jobs.jobvite.com`)  
**Why selected:** Staff/principal/architect level — a genuine level stretch.  
**Description notes:** posted_at anomaly: posted_at AFTER first_detected_at — age derived from first_detected_at; location is NULL

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 15. Toronto AI and Data Data Architect (Snowflake) ON M5H 0B3

**Company:** Client Technology  
**Category:** C — Staff / platform / AI stretch  
**ATS:** unknown  
**Age:** 41d (22-45d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-07-04T00:00:00+00:00` · **lastSeenAt:** `2026-08-14T03:04:26.906+00:00`  
**jobId:** `c9d1c1c3-01ce-4ca4-9efa-17594fac8bd5` · **canonical:** `c9d1c1c3-01ce-4ca4-9efa-17594fac8bd5`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `careers.ey.com`)  
**Why selected:** Staff/principal/architect level — a genuine level stretch.  
**Description notes:** posted_at is NULL — age derived from first_detected_at only; location is NULL

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 16. Atlanta National Consulting Microsoft Enterprise Platform Senior Manager (Architect & Solution Lead Role GA

**Company:** Client Technology  
**Category:** C — Staff / platform / AI stretch  
**ATS:** unknown  
**Age:** 41d (22-45d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-07-04T00:00:00+00:00` · **lastSeenAt:** `2026-08-14T03:04:26.906+00:00`  
**jobId:** `3177ec14-1af3-4233-9919-10b0d5e62c0f` · **canonical:** `3177ec14-1af3-4233-9919-10b0d5e62c0f`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `careers.ey.com`)  
**Why selected:** Staff/principal/architect level — a genuine level stretch.  
**Description notes:** posted_at is NULL — age derived from first_detected_at only; location is NULL

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 17. EDS Design Engineer

**Company:** Ford  
**Category:** D — Authorization-language case · `D3_offered`  
**ATS:** eightfold  
**Age:** 8d (8-21d)  
**postedAt:** `2026-08-06T16:59:03+00:00` · **firstDetectedAt:** `2026-08-06T16:59:03+00:00` · **lastSeenAt:** `2026-08-14T16:00:09.516+00:00`  
**jobId:** `6cf8a960-6fc0-4e28-92f3-b906a713e098` · **canonical:** `6cf8a960-6fc0-4e28-92f3-b906a713e098`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `ford.eightfold.ai`)  
**Why selected:** Sponsorship explicitly offered.  
**Description notes:** location is NULL

> Authorization language: “co/GSR Visa sponsorship is available for this position”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 18. Mechanical Engineer, Interceptor

**Company:** GITAI  
**Category:** D — Authorization-language case · `D4_general_boilerplate`  
**ATS:** greenhouse  
**Age:** 8d (8-21d)  
**postedAt:** `2026-08-12T21:57:42+00:00` · **firstDetectedAt:** `2026-08-06T17:56:39+00:00` · **lastSeenAt:** `2026-08-14T06:25:50.053+00:00`  
**jobId:** `6c0612fe-0614-424c-8520-57cadf21a3c7` · **canonical:** `6c0612fe-0614-424c-8520-57cadf21a3c7`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `job-boards.greenhouse.io`)  
**Why selected:** General work-authorization boilerplate that bars nobody — an OPT holder satisfies it.  
**Description notes:** posted_at anomaly: posted_at AFTER first_detected_at — age derived from first_detected_at

> Authorization language: “ citizenship is required due to the nature of GITAI's work with U”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 19. AI Engineer / Data Scientist, AI Senior Associate

**Company:** PwC  
**Category:** D — Authorization-language case · `D1_current_and_future`  
**ATS:** successfactors  
**Age:** 9d (8-21d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-08-04T23:00:00+00:00` · **lastSeenAt:** `2026-08-05T05:45:55.233894+00:00`  
**jobId:** `a3b0737d-e4b6-4ad8-bd9a-ba150ae87b35` · **canonical:** `a3b0737d-e4b6-4ad8-bd9a-ba150ae87b35`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `www.linkedin.com`)  
**Why selected:** Explicit bar on sponsorship now AND in the future — the one unambiguous restriction.  
**Description notes:** posted_at is NULL — age derived from first_detected_at only; last_seen_at is 9d old

> Authorization language: “on, and gender identity); age; disability; genetic information (including family medical history); veteran, marital, or citizenship status; or, any other status protected by law”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 20. Software Engineer (5489) (Boulder, CO) (Secret)

**Company:** Outside Analytics  
**Category:** D — Authorization-language case · `D2_scope_ambiguous`  
**ATS:** greenhouse  
**Age:** 10d (8-21d)  
**postedAt:** `2026-08-04T12:48:36+00:00` · **firstDetectedAt:** `2026-08-04T12:48:36+00:00` · **lastSeenAt:** `2026-08-14T07:24:34.675+00:00`  
**jobId:** `f2d7c2c1-0002-4405-8d19-a002c900fa3f` · **canonical:** `f2d7c2c1-0002-4405-8d19-a002c900fa3f`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `job-boards.greenhouse.io`)  
**Why selected:** Bare no-sponsorship statement with no temporal qualifier. Scope is unstated, which is the common real-world case.  
**Description notes:** no structural concerns noted

> Authorization language: “ Due to the clearance requirement, U”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 21. Graphical Software Developer

**Company:** Cgg  
**Category:** D — Authorization-language case · `D5_non_immigration`  
**ATS:** workday  
**Age:** 16d (8-21d)  
**postedAt:** `2026-07-28T19:09:08.592+00:00` · **firstDetectedAt:** `2026-07-28T21:33:21.586+00:00` · **lastSeenAt:** `2026-08-14T19:09:05.566+00:00`  
**jobId:** `8d5802b9-7458-4c15-8de2-cef23960e9db` · **canonical:** `8d5802b9-7458-4c15-8de2-cef23960e9db`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `cgg.wd103.myworkdayjobs.com`)  
**Why selected:** Commercial use of "sponsorship". Included to test that no visa requirement is inferred; not a plausible application for this resume.  
**Description notes:** no structural concerns noted

> Authorization language: “ work authorization or qualify for sponsorship”

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 22. Senior Lead Software Engineer - SCM Platform

**Company:** JPMorgan Chase & Co.  
**Category:** E — Fresh but incomplete or questionable  
**ATS:** oraclecloud  
**Age:** 22d (22-45d)  
**postedAt:** `2026-07-23T00:00:00+00:00` · **firstDetectedAt:** `2026-07-23T00:00:00+00:00` · **lastSeenAt:** `2026-07-25T01:28:22.098+00:00`  
**jobId:** `388c3e14-e52e-45c8-abba-a0ae4bea361b` · **canonical:** `388c3e14-e52e-45c8-abba-a0ae4bea361b`  
**Apply URL:** PRESENT_NOT_PROBED (known_ats, `jpmc.fa.oraclecloud.com`)  
**Why selected:** Fresh and plausible, but the description is a 132-character stub — nothing to extract requirements from.  
**Description notes:** description is 132 characters; last_seen_at is 20d old

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 23. Sales Engineer- Tampa

**Company:** Integrated Cooling Solutions  
**Category:** E — Fresh but incomplete or questionable  
**ATS:** custom  
**Age:** 22d (22-45d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-07-23T13:09:56+00:00` · **lastSeenAt:** `2026-07-23T18:19:33.566432+00:00`  
**jobId:** `7a660f23-81fc-4de7-8767-d7286a235e7a` · **canonical:** `7a660f23-81fc-4de7-8767-d7286a235e7a`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `www.adzuna.com`)  
**Why selected:** Fresh and plausible, but the description is a 286-character stub — nothing to extract requirements from.  
**Description notes:** description is 286 characters; posted_at is NULL — age derived from first_detected_at only; last_seen_at is 22d old

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 24. Oracle PL/SQL Developer

**Company:** NATIONMIND LLC  
**Category:** E — Fresh but incomplete or questionable  
**ATS:** custom  
**Age:** 23d (22-45d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-07-22T12:58:28+00:00` · **lastSeenAt:** `2026-07-22T18:19:38.024076+00:00`  
**jobId:** `3f596d27-9ab1-4810-8590-dd5ad9c33dd5` · **canonical:** `3f596d27-9ab1-4810-8590-dd5ad9c33dd5`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `www.adzuna.com`)  
**Why selected:** Fresh and plausible, but the description is a 286-character stub — nothing to extract requirements from.  
**Description notes:** description is 286 characters; posted_at is NULL — age derived from first_detected_at only; last_seen_at is 23d old

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

### 25. Urgent fully remote work opportunity :: Application Security Engineer

**Company:** Calsoft Labs  
**Category:** E — Fresh but incomplete or questionable  
**ATS:** custom  
**Age:** 24d (22-45d)  
**postedAt:** `NULL` · **firstDetectedAt:** `2026-07-21T14:59:05+00:00` · **lastSeenAt:** `2026-07-22T00:18:52.972996+00:00`  
**jobId:** `a5e2809f-1286-4a50-99ed-1d3b481c5f9a` · **canonical:** `a5e2809f-1286-4a50-99ed-1d3b481c5f9a`  
**Apply URL:** PRESENT_NOT_PROBED (employer_or_other, `www.adzuna.com`)  
**Why selected:** Fresh and plausible, but the description is a 286-character stub — nothing to extract requirements from.  
**Description notes:** description is 286 characters; posted_at is NULL — age derived from first_detected_at only; last_seen_at is 23d old

```
My decision:      [ ] APPLY_NOW   [ ] STRENGTHEN_FIRST   [ ] FIND_ACCESS   [ ] SKIP   [ ] INSUFFICIENT_DATA
Primary reason:   ______________________________________________________________
Confidence:       [ ] high   [ ] medium   [ ] low
Biggest concern:  ______________________________________________________________
What would change my decision?
                  ______________________________________________________________
```

