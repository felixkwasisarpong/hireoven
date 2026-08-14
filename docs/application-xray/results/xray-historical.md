# Application X-Ray — historical evaluation results

Ran 2026-08-14T12:36:49.255Z against the local database. **25/25 executed.**

Candidate fixture validated: `visa_status=opt`, `needs_sponsorship=True`, `opt_end_date=2026-09-03`.

## Totals

| Metric | Value |
| --- | --- |
| Executed | 25/25 |
| Actions | {'APPLY_NOW': 20, 'INSUFFICIENT_DATA': 1, 'SKIP': 4} |
| Rules | {'RI2': 20, 'RD2': 1, 'RE1': 3, 'RC1': 1} |
| Agreement with pre-registered calls | {'No': 7, 'Yes': 11, 'Partial': 7} |
| Target-employer authorization | {'YES': 25} |
| Rules firing with empty trace inputs | 0 |

## Authorization discriminators

| Case | Expected | Category | Action | Rule |
| --- | --- | --- | --- | --- |
| Oracle — AI & Cloud | genuine bar, scope unstated | `SPONSORSHIP_SCOPE_AMBIGUOUS` | SKIP | RE1 |
| Oracle Health | genuine citizenship | `CITIZENSHIP_REQUIRED` | SKIP | RC1 |
| Apple | trap: advertising | `—` | APPLY_NOW | RI2 |
| Sentry | trap: mentorship | `—` | SKIP | RE1 |

## Per job

| # | Job | Company | ATS | Mine | X-Ray | Rule | Agree | CAP | EV | EL | POS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Senior Java Full Stack Developer | Citigroup | custom | SKIP | **APPLY_NOW** | RI2 | No | MEETS | ADEQUATE | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 2 | Lead Software Engineer, Back End | Capital One | workday | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | EXCEEDS | THIN | NEEDS_CLARIFICATION | ALIGNED |
| 3 | Backend Engineer, Core Technology | Stripe | custom | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 4 | Senior Software Engineer, Backend | Coinbase | custom | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | MEETS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 5 | Senior Software Engineer, Backend  | Coinbase | custom | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | MEETS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 6 | Senior Software Engineer, Identity | Snowflake | ashby | APPLY_NOW | **INSUFFICIENT_DATA** | RD2 | No | MEETS | ADEQUATE | NEEDS_CLARIFICATION | ALIGNED |
| 7 | Senior Software Engineer | Match Group | lever | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | EXCEEDS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 8 | Software Engineer, DevInfra | Mixpanel | greenhouse | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | EXCEEDS | BURIED | EMPLOYER_ACTION_MAY_BE_NEEDED | TUNABLE |
| 9 | Senior Software Engineer Applied G | Citigroup | custom | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | MEETS | BURIED | EMPLOYER_ACTION_MAY_BE_NEEDED | TUNABLE |
| 10 | Senior AI Software Engineer | Amplitude | greenhouse | STRENGTHEN_FIRST | **APPLY_NOW** | RI2 | Partial | MEETS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 11 | Senior SWE, AI Backend: Observe by | Snowflake | ashby | APPLY_NOW | **APPLY_NOW** | RI2 | Yes | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 12 | Staff Machine Learning Engineer -  | Snowflake | ashby | STRENGTHEN_FIRST | **APPLY_NOW** | RI2 | Partial | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 13 | Applied Scientist, Customer FinOps | Snowflake | ashby | STRENGTHEN_FIRST | **SKIP** | RE1 | No | MISMATCH | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 14 | Staff Software Engineer - AI SDK | Temporal | greenhouse | STRENGTHEN_FIRST | **APPLY_NOW** | RI2 | Partial | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | TUNABLE |
| 15 | Staff Software Engineer, Cortex AI | Snowflake | ashby | STRENGTHEN_FIRST | **APPLY_NOW** | RI2 | Partial | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 16 | Staff Software Engineer (Platform  | Coinbase | custom | STRENGTHEN_FIRST | **APPLY_NOW** | RI2 | Partial | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 17 | Staff Software Engineer - AI I | Thomson Reuters | workday | STRENGTHEN_FIRST | **APPLY_NOW** | RI2 | Partial | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | ALIGNED |
| 18 | Principal Software Engineer – AI & | Oracle | custom | SKIP | **SKIP** | RE1 | Yes | MISMATCH | THIN | NEEDS_CLARIFICATION | ALIGNED |
| 19 | Principal Software Developer - Ora | Oracle | custom | SKIP | **SKIP** | RC1 | Yes | NEAR_MISS | THIN | EXPLICIT_REQUIREMENT_CONFLICT | MISALIGNED |
| 20 | Software Engineer - Early Career ( | Apple | custom | STRENGTHEN_FIRST | **APPLY_NOW** | RI2 | Partial | EXCEEDS | UNREADABLE | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 21 | Engineering Manager, (Apple/Androi | Sentry | custom | SKIP | **SKIP** | RE1 | Yes | MISMATCH | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 22 | Forward Deployed Software Engineer | Palantir | lever | INSUFFICIENT_DATA | **APPLY_NOW** | RI2 | No | EXCEEDS | ADEQUATE | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 23 | Application Security Engineer | Palantir | lever | INSUFFICIENT_DATA | **APPLY_NOW** | RI2 | No | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 24 | Software Engineer, Applied AI | mercor | ashby | INSUFFICIENT_DATA | **APPLY_NOW** | RI2 | No | EXCEEDS | ADEQUATE | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
| 25 | engineering and product | Samsara Inc. | custom | INSUFFICIENT_DATA | **APPLY_NOW** | RI2 | No | NEAR_MISS | THIN | EMPLOYER_ACTION_MAY_BE_NEEDED | MISALIGNED |
