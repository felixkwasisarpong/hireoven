# Application X-Ray — evaluation pack (25 jobs)

Generated from the **local** database (`localhost:54329`, `hireoven`).
Candidate profile: Felix Sarpong — Backend SWE, 8 yrs, senior; Java/Spring/Python/PostgreSQL;
fintech history (FIDO, EFT Corporation, Republic Bank); ML research at Texas Tech.
`visa_status=opt`, `needs_sponsorship=true`, **`opt_end_date = 2026-09-03`**.

## Read this before scoring

The local snapshot is frozen at **2026-05-04**. The freshest active job is **101 days old**;
there are **zero** jobs under 45 days. Two consequences:

- `G_WINDOW = "stale"` on all 25 → `repairFitsWindow` is false → **`STRENGTHEN_FIRST` cannot fire**
  except via `RF1`/`RE3`. Do **not** score *"Recommended actions useful"* — you would be
  measuring the snapshot, not the engine.
- **Hiring Reality** is degraded for everything, so expect `RI1` (*APPLY_NOW, verify first,
  low confidence*) a lot. Score it only for whether the **reasoning** is right, not the band.

The other four dimensions — **Capability, Evidence, Authorization, Positioning** — are
age-independent and fully valid here. Category D is the one that matters most given your OPT date.

Run each as: `GET /api/jobs/<id>/xray`

---

## A. Backend / fintech — you appear strongly qualified

### 1. Senior Java Full Stack Developer

**Job:** `94d93b1f-17ed-484f-bd5f-26d4b314f6f0`  
**Company:** Citigroup  
**Role family:** Backend / Java  
**Posting age:** 103 days  
**ATS:** custom  
**Why selected:** Java + banking. Closest single match to your FIDO/EFT/Republic Bank history.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  SKIP
   reason: is_active=false - closed
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

### 2. Lead Software Engineer, Back End

**Job:** `6466c48e-7379-4ac8-8794-4460560aaad5`  
**Company:** Capital One  
**Role family:** Backend  
**Posting age:** 101 days  
**ATS:** workday  
**Why selected:** Lead Back End at a bank, on Workday. Level and domain both line up.  
**Flags:** is_active=false

```
My decision before X-Ray:  APPLY_NOW
   reason: Java backend at a bank, senior level, exact lane
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=low
Agreement:                 Yes

Bands   hiringReality=LIKELY_LIVE  capability=EXCEEDS
        evidence=THIN  eligibility=NEEDS_CLARIFICATION  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=['SPONSORSHIP_SCOPE_AMBIGUOUS']
Actions ['confirm_everify_participation', 'confirm_future_sponsorship_policy', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 3. Backend Engineer, Core Technology

**Job:** `cd82fc7d-54b4-4811-8192-14be418f04a3`  
**Company:** Stripe  
**Role family:** Backend / payments  
**Posting age:** 106 days  
**ATS:** custom  
**Why selected:** Payments infrastructure — your EFT Corporation lane.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  APPLY_NOW
   reason: payments backend, your EFT lane
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Yes

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 4. Senior Software Engineer, Backend

**Job:** `ee165f9f-6834-41c4-9c8c-c38b0bd97d16`  
**Company:** Coinbase  
**Role family:** Backend  
**Posting age:** 113 days  
**ATS:** custom  
**Why selected:** Senior backend at a fintech; no level stretch.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  APPLY_NOW
   reason: senior backend fintech, no stretch
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

### 5. Senior Software Engineer, Backend (Platform - Financial En

**Job:** `3d779276-bb8f-41fb-8773-ac20a9740a7d`  
**Company:** Coinbase  
**Role family:** Backend / fintech  
**Posting age:** 113 days  
**ATS:** custom  
**Why selected:** Financial platform team — domain-specific backend.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  APPLY_NOW
   reason: financial platform backend
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

### 6. Senior Software Engineer, Identity & Access Management

**Job:** `08b30169-eefc-46ea-ba52-f725460f480e`  
**Company:** Snowflake  
**Role family:** Backend / security  
**Posting age:** 105 days  
**ATS:** ashby  
**Why selected:** Identity & Access. You list Spring Security explicitly.  
**Flags:** is_active=false

```
My decision before X-Ray:  APPLY_NOW
   reason: IAM - Spring Security is on your resume
X-Ray decision:            INSUFFICIENT_DATA   rule=RD2  stage=D_sufficiency  confidence=unknown
Agreement:                 No

Bands   hiringReality=LIKELY_LIVE  capability=MEETS
        evidence=ADEQUATE  eligibility=NEEDS_CLARIFICATION  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=['CLEARANCE_REQUIRED']
Actions ['confirm_everify_participation']
Gaps    2
Headline Not enough to judge

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 7. Senior Software Engineer

**Job:** `d30fea9e-8479-49f0-b485-316c373f09a0`  
**Company:** Match Group  
**Role family:** Backend  
**Posting age:** 119 days  
**ATS:** lever  
**Why selected:** Senior SWE on Lever — ATS spread, plain senior backend.  
**Flags:** is_active=false

```
My decision before X-Ray:  APPLY_NOW
   reason: plain senior backend
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Yes

Bands   hiringReality=LIKELY_LIVE  capability=EXCEEDS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 8. Software Engineer, DevInfra

**Job:** `d96db4a8-9acb-41bc-8f19-11ea046ecd50`  
**Company:** Mixpanel  
**Role family:** Backend / infra  
**Posting age:** 104 days  
**ATS:** greenhouse  
**Why selected:** DevInfra on Greenhouse — adjacent but well within reach.  
**Flags:** is_active=false

```
My decision before X-Ray:  APPLY_NOW
   reason: devinfra, adjacent but reachable
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Yes

Bands   hiringReality=LIKELY_LIVE  capability=EXCEEDS
        evidence=BURIED  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

---

## B. AI / ML

### 9. Senior Software Engineer Applied Gen AI Engineering

**Job:** `282eba74-159d-4dae-8ae3-8ac173564539`  
**Company:** Citigroup  
**Role family:** AI/ML + backend  
**Posting age:** 103 days  
**ATS:** custom  
**Why selected:** Gen AI at a bank — the bridge between your fintech depth and your ML research.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  APPLY_NOW
   reason: GenAI at a bank - bridges fintech depth and ML research
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

### 10. Senior AI Software Engineer

**Job:** `587de755-1293-4531-98b8-229a8f3533a3`  
**Company:** Amplitude  
**Role family:** AI/ML  
**Posting age:** 104 days  
**ATS:** greenhouse  
**Why selected:** Senior AI SWE on Greenhouse.  
**Flags:** is_active=false

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: senior AI SWE - ML is research-only on paper
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Partial

Bands   hiringReality=LIKELY_LIVE  capability=MEETS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 11. Senior SWE, AI Backend: Observe by Snowflake

**Job:** `82ab60c4-69a8-4098-a404-82b712e43150`  
**Company:** Snowflake  
**Role family:** AI/ML + backend  
**Posting age:** 118 days  
**ATS:** ashby  
**Why selected:** "AI Backend" — tests whether X-Ray reads this as backend or as ML.  
**Flags:** is_active=false

```
My decision before X-Ray:  APPLY_NOW
   reason: AI Backend reads as backend
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Yes

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 12. Staff Machine Learning Engineer - Cortex Code Quality

**Job:** `35757934-eace-40ca-9291-53df90f9e48e`  
**Company:** Snowflake  
**Role family:** ML engineering  
**Posting age:** 127 days  
**ATS:** ashby  
**Why selected:** Staff MLE. Production ML, which your résumé shows as research only.  
**Flags:** is_active=false

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: Staff MLE - production ML not evidenced
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Partial

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 13. Applied Scientist, Customer FinOps Intelligence

**Job:** `349df183-df7b-466b-929f-0c07546400e9`  
**Company:** Snowflake  
**Role family:** Applied science  
**Posting age:** 121 days  
**ATS:** ashby  
**Why selected:** Applied Scientist + FinOps. Research-flavoured, finance domain.  
**Flags:** is_active=false

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: Applied Scientist - research lane, level stretch
X-Ray decision:            SKIP   rule=RE1  stage=E_capability  confidence=medium
Agreement:                 No

Bands   hiringReality=LIKELY_LIVE  capability=MISMATCH
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'choose_different_target']
Gaps    3
Headline Skip this one

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

---

## C. Reasonable stretch

### 14. Staff Software Engineer - AI SDK

**Job:** `ec94f69a-c0a5-4c97-bb11-60d91198877a`  
**Company:** Temporal  
**Role family:** AI infra  
**Posting age:** 103 days  
**ATS:** greenhouse  
**Why selected:** Staff level + AI SDK. One level up, adjacent lane.  
**Flags:** is_active=false

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: Staff + AI SDK, one level up
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Partial

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 15. Staff Software Engineer, Cortex AI Infrastructure

**Job:** `bdd13595-162d-4d86-81e3-acebad4c817e`  
**Company:** Snowflake  
**Role family:** AI infra  
**Posting age:** 108 days  
**ATS:** ashby  
**Why selected:** Staff, Cortex AI Infrastructure.  
**Flags:** is_active=false

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: Staff AI infra
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Partial

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 16. Staff Software Engineer (Platform - Financial Engineering)

**Job:** `b1f68f3d-8ac0-4df3-ac34-c1d678afb830`  
**Company:** Coinbase  
**Role family:** Backend / fintech  
**Posting age:** 113 days  
**ATS:** custom  
**Why selected:** Staff on a financial engine — domain fits, level stretches.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: Staff, domain fits, level stretches
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

### 17. Staff Software Engineer - AI I

**Job:** `076db0e8-fb74-4f13-b52b-04eb11a3928b`  
**Company:** Thomson Reuters  
**Role family:** AI/ML  
**Posting age:** 101 days  
**ATS:** workday  
**Why selected:** Staff AI on Workday at a data/analytics firm.  
**Flags:** is_active=false

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: Staff AI
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

---

## D. Visa / authorization language present

### 18. Principal Software Engineer – AI & Cloud (Healthcare / EHR

**Job:** `dd6ead4c-ee8c-4ce6-b21b-84b39d13a2e7`  
**Company:** Oracle  
**Role family:** Backend / AI  
**Posting age:** 104 days  
**ATS:** custom  
**Why selected:** GENUINE. "full time REMOTE role with no sponsorship available." No temporal marker -> should be SPONSORSHIP_SCOPE_AMBIGUOUS, not an automatic skip.  
**Flags:** is_active=false

```
My decision before X-Ray:  SKIP
   reason: no sponsorship available + you need it
X-Ray decision:            SKIP   rule=RE1  stage=E_capability  confidence=medium
Agreement:                 Yes

Bands   hiringReality=LIKELY_LIVE  capability=MISMATCH
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=['SPONSORSHIP_OFFERED']
Actions ['confirm_everify_participation', 'choose_different_target']
Gaps    4
Headline Skip this one

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 19. Principal Software Developer - Oracle Health, US citizensh

**Job:** `7140bf3e-82ad-4334-b800-f8454234141e`  
**Company:** Oracle  
**Role family:** Backend  
**Posting age:** 115 days  
**ATS:** custom  
**Why selected:** GENUINE. Title itself says US citizenship; body has Work Authorization / Clearance.  
**Flags:** is_active=false

```
My decision before X-Ray:  SKIP
   reason: US citizenship / clearance
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 No

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=['SPONSORSHIP_OFFERED']
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 20. Software Engineer - Early Career (Front-end)

**Job:** `23528ac4-e204-4b11-90dd-706c2f48e5b8`  
**Company:** Apple  
**Role family:** Frontend  
**Posting age:** 105 days  
**ATS:** custom  
**Why selected:** TRAP. "Sponsorship integrations ... in live sports on Apple TV help advertisers" — advertising sponsorship, not visa.  
**Flags:** is_active=false

```
My decision before X-Ray:  STRENGTHEN_FIRST
   reason: TRAP: advertising sponsorship, NOT visa. Also frontend + early career = wrong lane/level
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 Partial

Bands   hiringReality=LIKELY_LIVE  capability=EXCEEDS
        evidence=UNREADABLE  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    4
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 21. Engineering Manager, (Apple/Android), SDK Vienna, Austria

**Job:** `f97f82e0-b514-4f14-a287-040a5d41cdae`  
**Company:** Sentry  
**Role family:** Eng management  
**Posting age:** 113 days  
**ATS:** custom  
**Why selected:** TRAP. "mentor, coach, and sponsor a team of 4-6 engineers" — mentorship, not visa.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  SKIP
   reason: TRAP: 'sponsor a team' is mentorship. Real reason to skip is eng-management lane, not visa
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

---

## E. Old / questionable / possibly inactive

### 22. Forward Deployed Software Engineer

**Job:** `adb9e4b6-5cd5-4096-a403-30533119d581`  
**Company:** Palantir  
**Role family:** Forward deployed  
**Posting age:** 6095 days  
**ATS:** lever  
**Why selected:** 6,095 days old (~16.7 yr). Corrupt or ancient date. Has an exact is_active=false twin in the DB.  
**Flags:** is_active=false

```
My decision before X-Ray:  INSUFFICIENT_DATA
   reason: 6095d age is corrupt - cannot judge
X-Ray decision:            ENGINE ERROR — Job not found
Agreement:                 n/a
```

### 23. Application Security Engineer

**Job:** `7a23a5da-991f-432f-b1c7-d95a3ba2e375`  
**Company:** Palantir  
**Role family:** Security engineering  
**Posting age:** 5084 days  
**ATS:** lever  
**Why selected:** 5,084 days old. Same duplicate-pair pattern.  
**Flags:** is_active=false

```
My decision before X-Ray:  INSUFFICIENT_DATA
   reason: 5084d age corrupt; security lane anyway
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 No

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

---

## F. Incomplete / conflicting information

### 24. Software Engineer, Applied AI

**Job:** `82b14ca9-6d60-41da-b9f8-7abae7e32473`  
**Company:** mercor  
**Role family:** AI engineering  
**Posting age:** 101 days  
**ATS:** ashby  
**Why selected:** Description is 337 characters. Almost nothing to extract requirements from.  
**Flags:** is_active=false, description only 337 chars

```
My decision before X-Ray:  INSUFFICIENT_DATA
   reason: 337-char description
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=unknown
Agreement:                 No

Bands   hiringReality=LIVE  capability=EXCEEDS
        evidence=ADEQUATE  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    2
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

### 25. engineering and product

**Job:** `8ab94406-57bd-4c59-a077-8b18e0c06708`  
**Company:** Samsara Inc.  
**Role family:** UNCLEAR  
**Posting age:** 110 days  
**ATS:** custom  
**Why selected:** Title is "engineering and product" — a department page captured as a job. Location NULL, remote=true.  
**Flags:** is_active=false, location NULL

```
My decision before X-Ray:  INSUFFICIENT_DATA
   reason: 'engineering and product' is a department page
X-Ray decision:            APPLY_NOW   rule=RI2  stage=I_apply  confidence=medium
Agreement:                 No

Bands   hiringReality=LIKELY_LIVE  capability=NEAR_MISS
        evidence=THIN  eligibility=EMPLOYER_ACTION_MAY_BE_NEEDED  positioning=MISALIGNED
Auth    canWorkForTargetEmployer=YES   postingCategories=[]
Actions ['confirm_everify_participation', 'confirm_requirement_status']
Gaps    3
Headline Apply now

Hiring Reality correct      1 2 3 4 5   (band unscoreable - snapshot is stale)
Capability correct          1 2 3 4 5
Evidence correct            1 2 3 4 5
Authorization correct       1 2 3 4 5
Positioning correct         1 2 3 4 5

Revealed something I missed?      ____________________________________
Claimed something unsupported?    ____________________________________
Confused 'not found' with 'do not have'?  __________________________
Treated unknown negatively?       ____________________________________
Would it make me miss a good opportunity?  _________________________
Would I follow it?                ____________________________________
Most important problem:           ____________________________________
```

---

## ATS coverage

| ATS | Jobs |
| --- | --- |
| custom | 11 |
| ashby | 6 |
| lever | 3 |
| greenhouse | 3 |
| workday | 2 |

## What each category is testing

| Category | The question |
| --- | --- |
| A | Does it agree with you when you are genuinely strong, without inflating? |
| B | Does it separate your ML *research* from production ML *engineering*? |
| C | Does it call a stretch a stretch, rather than a mismatch or a match? |
| D | **The critical one.** Two genuine restrictions, two false positives. Does it tell them apart, and does it handle scope-ambiguous language without skipping you? |
| E | Does it degrade honestly on absurd data rather than asserting closure? |
| F | Does it return INSUFFICIENT_DATA rather than inventing a judgment? |
