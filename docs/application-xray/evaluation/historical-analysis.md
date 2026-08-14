# Application X-Ray Historical Evaluation Results

Generated: 2026-08-14T03:31:54.377Z
API origin: http://localhost:3000
Pack: docs/application-xray/xray-eval-pack.md
Candidate: Felix Sarpong (6ab1784e-1d7f-4908-9725-82d4a69c400f), default resume requested by omitting resumeId.

## Scope Rules Applied

- Did not regenerate the questionnaire or modify X-Ray rules.
- Called `GET /api/jobs/<id>/xray` for every listed job using an authenticated `ho_session` for Felix.
- Did not score Hiring Reality accuracy because the database snapshot is stale.
- Did not score action usefulness and did not calculate overall final-action agreement.
- `RB1` definitive closure is counted separately from `RI1` stale uncertainty.

## Summary

- Jobs listed: 25
- HTTP 200 X-Ray responses: 4
- API failures: 21
- RB1 definitive closures: 1
- RI1 stale-uncertainty apply-first responses: 0
- Successful final actions: {"INSUFFICIENT_DATA":3,"SKIP":1}
- Successful selected rules: {"RD1":3,"RB1":1}

## Critical Expectations

| Expectation | Executable responses | Findings |
| --- | ---: | ---: |
| Backend/fintech alignment without seniority inflation | 0 | 0 |
| ML research not represented as production ML | 4 | 0 |
| Staff roles normally stretch unless level evidence supports them | 2 | 0 |
| Oracle generic no-sponsorship remains scope-correct | 1 | 1 |
| Oracle citizenship/clearance detected accurately | 0 | 0 |
| Apple advertising sponsorship does not trigger visa logic | 0 | 0 |
| Sentry sponsor-a-team does not trigger visa logic | 0 | 0 |
| Sparse/malformed jobs produce honest uncertainty | 0 | 0 |
| NOT_FOUND never becomes Felix does not have this | 4 | 0 |
| No unsupported candidate claim appears | 4 | 0 |

## Issue Lists

### False Visa Match (1)

- #18 Oracle — Principal Software Engineer – AI & Cloud (Healthcare / EHR (dd6ead4c-ee8c-4ce6-b21b-84b39d13a2e7): Oracle Health role classified text as SPONSORSHIP_OFFERED even though the excerpt says “no sponsorship available”; expected a no-sponsorship category with the corrected scope semantics, not an offer category.

### Unsupported Claim (0)

None observed in executable responses.

### Unknown To Negative Conversion (0)

None observed in executable responses.

### Incorrect Capability Classification (0)

None observed in executable responses.

### Incorrect Evidence Classification (1)

- #15 Snowflake — Staff Software Engineer, Cortex AI Infrastructure (bdd13595-162d-4d86-81e3-acebad4c817e): Evidence is STRONG while capability is UNKNOWN; this can overstate proof quality.

### Unexpected Final Action (0)

None observed in executable responses.

### Api Failure (21)

- #1 Citigroup — Senior Java Full Stack Developer (94d93b1f-17ed-484f-bd5f-26d4b314f6f0): GET /api/jobs/94d93b1f-17ed-484f-bd5f-26d4b314f6f0/xray returned 404 JOB_NOT_FOUND.
- #2 Capital One — Lead Software Engineer, Back End (6466c48e-7379-4ac8-8794-4460560aaad5): GET /api/jobs/6466c48e-7379-4ac8-8794-4460560aaad5/xray returned 404 JOB_NOT_FOUND.
- #3 Stripe — Backend Engineer, Core Technology (cd82fc7d-54b4-4811-8192-14be418f04a3): GET /api/jobs/cd82fc7d-54b4-4811-8192-14be418f04a3/xray returned 404 JOB_NOT_FOUND.
- #4 Coinbase — Senior Software Engineer, Backend (ee165f9f-6834-41c4-9c8c-c38b0bd97d16): GET /api/jobs/ee165f9f-6834-41c4-9c8c-c38b0bd97d16/xray returned 404 JOB_NOT_FOUND.
- #5 Coinbase — Senior Software Engineer, Backend (Platform - Financial En (3d779276-bb8f-41fb-8773-ac20a9740a7d): GET /api/jobs/3d779276-bb8f-41fb-8773-ac20a9740a7d/xray returned 404 JOB_NOT_FOUND.
- #6 Snowflake — Senior Software Engineer, Identity & Access Management (08b30169-eefc-46ea-ba52-f725460f480e): GET /api/jobs/08b30169-eefc-46ea-ba52-f725460f480e/xray returned 404 JOB_NOT_FOUND.
- #7 Match Group — Senior Software Engineer (d30fea9e-8479-49f0-b485-316c373f09a0): GET /api/jobs/d30fea9e-8479-49f0-b485-316c373f09a0/xray returned 404 JOB_NOT_FOUND.
- #8 Mixpanel — Software Engineer, DevInfra (d96db4a8-9acb-41bc-8f19-11ea046ecd50): GET /api/jobs/d96db4a8-9acb-41bc-8f19-11ea046ecd50/xray returned 404 JOB_NOT_FOUND.
- #9 Citigroup — Senior Software Engineer Applied Gen AI Engineering (282eba74-159d-4dae-8ae3-8ac173564539): GET /api/jobs/282eba74-159d-4dae-8ae3-8ac173564539/xray returned 404 JOB_NOT_FOUND.
- #10 Amplitude — Senior AI Software Engineer (587de755-1293-4531-98b8-229a8f3533a3): GET /api/jobs/587de755-1293-4531-98b8-229a8f3533a3/xray returned 404 JOB_NOT_FOUND.
- #12 Snowflake — Staff Machine Learning Engineer - Cortex Code Quality (35757934-eace-40ca-9291-53df90f9e48e): GET /api/jobs/35757934-eace-40ca-9291-53df90f9e48e/xray returned 404 JOB_NOT_FOUND.
- #13 Snowflake — Applied Scientist, Customer FinOps Intelligence (349df183-df7b-466b-929f-0c07546400e9): GET /api/jobs/349df183-df7b-466b-929f-0c07546400e9/xray returned 404 JOB_NOT_FOUND.
- #16 Coinbase — Staff Software Engineer (Platform - Financial Engineering) (b1f68f3d-8ac0-4df3-ac34-c1d678afb830): GET /api/jobs/b1f68f3d-8ac0-4df3-ac34-c1d678afb830/xray returned 404 JOB_NOT_FOUND.
- #17 Thomson Reuters — Staff Software Engineer - AI I (076db0e8-fb74-4f13-b52b-04eb11a3928b): GET /api/jobs/076db0e8-fb74-4f13-b52b-04eb11a3928b/xray returned 404 JOB_NOT_FOUND.
- #19 Oracle — Principal Software Developer - Oracle Health, US citizensh (7140bf3e-82ad-4334-b800-f8454234141e): GET /api/jobs/7140bf3e-82ad-4334-b800-f8454234141e/xray returned 404 JOB_NOT_FOUND.
- #20 Apple — Software Engineer - Early Career (Front-end) (23528ac4-e204-4b11-90dd-706c2f48e5b8): GET /api/jobs/23528ac4-e204-4b11-90dd-706c2f48e5b8/xray returned 404 JOB_NOT_FOUND.
- #21 Sentry — Engineering Manager, (Apple/Android), SDK Vienna, Austria (f97f82e0-b514-4f14-a287-040a5d41cdae): GET /api/jobs/f97f82e0-b514-4f14-a287-040a5d41cdae/xray returned 404 JOB_NOT_FOUND.
- #22 Palantir — Forward Deployed Software Engineer (adb9e4b6-5cd5-4096-a403-30533119d581): GET /api/jobs/adb9e4b6-5cd5-4096-a403-30533119d581/xray returned 404 JOB_NOT_FOUND.
- #23 Palantir — Application Security Engineer (7a23a5da-991f-432f-b1c7-d95a3ba2e375): GET /api/jobs/7a23a5da-991f-432f-b1c7-d95a3ba2e375/xray returned 404 JOB_NOT_FOUND.
- #24 mercor — Software Engineer, Applied AI (82b14ca9-6d60-41da-b9f8-7abae7e32473): GET /api/jobs/82b14ca9-6d60-41da-b9f8-7abae7e32473/xray returned 404 JOB_NOT_FOUND.
- #25 Samsara Inc. — engineering and product (8ab94406-57bd-4c59-a077-8b18e0c06708): GET /api/jobs/8ab94406-57bd-4c59-a077-8b18e0c06708/xray returned 404 JOB_NOT_FOUND.

## Per-Job Results

### 1. Citigroup — Senior Java Full Stack Developer

- Job ID: `94d93b1f-17ed-484f-bd5f-26d4b314f6f0`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 2. Capital One — Lead Software Engineer, Back End

- Job ID: `6466c48e-7379-4ac8-8794-4460560aaad5`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 3. Stripe — Backend Engineer, Core Technology

- Job ID: `cd82fc7d-54b4-4811-8192-14be418f04a3`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 4. Coinbase — Senior Software Engineer, Backend

- Job ID: `ee165f9f-6834-41c4-9c8c-c38b0bd97d16`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 5. Coinbase — Senior Software Engineer, Backend (Platform - Financial En

- Job ID: `3d779276-bb8f-41fb-8773-ac20a9740a7d`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 6. Snowflake — Senior Software Engineer, Identity & Access Management

- Job ID: `08b30169-eefc-46ea-ba52-f725460f480e`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 7. Match Group — Senior Software Engineer

- Job ID: `d30fea9e-8479-49f0-b485-316c373f09a0`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 8. Mixpanel — Software Engineer, DevInfra

- Job ID: `d96db4a8-9acb-41bc-8f19-11ea046ecd50`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Backend/fintech alignment check; do not inflate seniority.

### 9. Citigroup — Senior Software Engineer Applied Gen AI Engineering

- Job ID: `282eba74-159d-4dae-8ae3-8ac173564539`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 10. Amplitude — Senior AI Software Engineer

- Job ID: `587de755-1293-4531-98b8-229a8f3533a3`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 11. Snowflake — Senior SWE, AI Backend: Observe by Snowflake

- Job ID: `82ab60c4-69a8-4098-a404-82b712e43150`
- HTTP status: 200
- Final action: INSUFFICIENT_DATA
- Selected rule: RD1
- Confidence: unknown
- Bands: HR=LIVE; CAP=UNKNOWN; EV=ADEQUATE; EL=EMPLOYER_ACTION_MAY_BE_NEEDED; POS=MISALIGNED
- Authorization categories: none
- Capability: Capability cannot be assessed from the supplied inputs.; findings=1; roleFamily=unknown; careerFitScore=null
- Evidence: The resume shows enough relevant evidence for this role.; findings=0; verification=inferred
- Positioning: The resume appears aimed at a different role.; supportedMissing=0; unsupportedMissing=4
- Top risks: none
- Recommended actions: complete_profile
- Data gaps: capability-inputs-missing, career-fit-score-missing, field-corpus-unavailable, role-specific-sponsorship-unknown, years-requirement-unstated
- Canonical: not_a_duplicate; evaluated=82ab60c4-69a8-4098-a404-82b712e43150; hops=0
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 12. Snowflake — Staff Machine Learning Engineer - Cortex Code Quality

- Job ID: `35757934-eace-40ca-9291-53df90f9e48e`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 13. Snowflake — Applied Scientist, Customer FinOps Intelligence

- Job ID: `349df183-df7b-466b-929f-0c07546400e9`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 14. Temporal — Staff Software Engineer - AI SDK

- Job ID: `ec94f69a-c0a5-4c97-bb11-60d91198877a`
- HTTP status: 200
- Final action: SKIP
- Selected rule: RB1
- Confidence: high
- Bands: HR=CLOSED; CAP=UNKNOWN; EV=ADEQUATE; EL=EMPLOYER_ACTION_MAY_BE_NEEDED; POS=MISALIGNED
- Authorization categories: none
- Capability: Capability cannot be assessed from the supplied inputs.; findings=1; roleFamily=unknown; careerFitScore=null
- Evidence: The resume shows enough relevant evidence for this role.; findings=0; verification=inferred
- Positioning: The resume appears aimed at a different role.; supportedMissing=0; unsupportedMissing=5
- Top risks: none
- Recommended actions: confirm_everify_participation, choose_different_target
- Data gaps: capability-inputs-missing, career-fit-score-missing, everify-participation-unknown, field-corpus-unavailable, role-specific-sponsorship-unknown, years-requirement-unstated
- Canonical: not_a_duplicate; evaluated=ec94f69a-c0a5-4c97-bb11-60d91198877a; hops=0
- Closure distinction: `RB1` definitive closure, not stale uncertainty.
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 15. Snowflake — Staff Software Engineer, Cortex AI Infrastructure

- Job ID: `bdd13595-162d-4d86-81e3-acebad4c817e`
- HTTP status: 200
- Final action: INSUFFICIENT_DATA
- Selected rule: RD1
- Confidence: unknown
- Bands: HR=LIVE; CAP=UNKNOWN; EV=STRONG; EL=EMPLOYER_ACTION_MAY_BE_NEEDED; POS=MISALIGNED
- Authorization categories: none
- Capability: Capability cannot be assessed from the supplied inputs.; findings=1; roleFamily=unknown; careerFitScore=null
- Evidence: The resume makes the relevant evidence easy to find.; findings=0; verification=inferred
- Positioning: The resume appears aimed at a different role.; supportedMissing=0; unsupportedMissing=5
- Top risks: none
- Recommended actions: complete_profile
- Data gaps: capability-inputs-missing, career-fit-score-missing, field-corpus-unavailable, role-specific-sponsorship-unknown, years-requirement-unstated
- Canonical: not_a_duplicate; evaluated=bdd13595-162d-4d86-81e3-acebad4c817e; hops=0
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 16. Coinbase — Staff Software Engineer (Platform - Financial Engineering)

- Job ID: `b1f68f3d-8ac0-4df3-ac34-c1d678afb830`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 17. Thomson Reuters — Staff Software Engineer - AI I

- Job ID: `076db0e8-fb74-4f13-b52b-04eb11a3928b`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: AI/ML/staff check; research must not become production ML, staff should stretch without level evidence.

### 18. Oracle — Principal Software Engineer – AI & Cloud (Healthcare / EHR

- Job ID: `dd6ead4c-ee8c-4ce6-b21b-84b39d13a2e7`
- HTTP status: 200
- Final action: INSUFFICIENT_DATA
- Selected rule: RD1
- Confidence: unknown
- Bands: HR=LIKELY_CLOSED; CAP=UNKNOWN; EV=ADEQUATE; EL=EMPLOYER_ACTION_MAY_BE_NEEDED; POS=MISALIGNED
- Authorization categories: SPONSORSHIP_OFFERED
- Capability: Capability cannot be assessed from the supplied inputs.; findings=1; roleFamily=unknown; careerFitScore=null
- Evidence: The resume shows enough relevant evidence for this role.; findings=0; verification=inferred
- Positioning: The resume appears aimed at a different role.; supportedMissing=0; unsupportedMissing=2
- Top risks: posting_may_be_closed:high
- Recommended actions: complete_profile
- Data gaps: capability-inputs-missing, career-fit-score-missing, field-corpus-unavailable, ghost-risk-cache-stale, role-specific-sponsorship-unknown, years-requirement-unstated
- Canonical: not_a_duplicate; evaluated=dd6ead4c-ee8c-4ce6-b21b-84b39d13a2e7; hops=0
- Expectation notes: Oracle visa-language edge case.

### 19. Oracle — Principal Software Developer - Oracle Health, US citizensh

- Job ID: `7140bf3e-82ad-4334-b800-f8454234141e`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Oracle visa-language edge case.

### 20. Apple — Software Engineer - Early Career (Front-end)

- Job ID: `23528ac4-e204-4b11-90dd-706c2f48e5b8`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Apple advertising sponsorship wording must not trigger visa logic.

### 21. Sentry — Engineering Manager, (Apple/Android), SDK Vienna, Austria

- Job ID: `f97f82e0-b514-4f14-a287-040a5d41cdae`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Sentry team sponsorship wording must not trigger visa logic.

### 22. Palantir — Forward Deployed Software Engineer

- Job ID: `adb9e4b6-5cd5-4096-a403-30533119d581`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Sparse/malformed job should produce honest uncertainty.

### 23. Palantir — Application Security Engineer

- Job ID: `7a23a5da-991f-432f-b1c7-d95a3ba2e375`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Sparse/malformed job should produce honest uncertainty.

### 24. mercor — Software Engineer, Applied AI

- Job ID: `82b14ca9-6d60-41da-b9f8-7abae7e32473`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Sparse/malformed job should produce honest uncertainty.

### 25. Samsara Inc. — engineering and product

- Job ID: `8ab94406-57bd-4c59-a077-8b18e0c06708`
- HTTP status: 404 (JOB_NOT_FOUND)
- Expectation notes: Sparse/malformed job should produce honest uncertainty.

