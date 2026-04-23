# Job Normalization Examples

This is deliverable #9: example transformations from raw crawler payloads to canonical normalized output.

## Generate examples

```bash
npm run jobs:generate-normalization-examples
```

Generated file:
- `scripts/output/job-normalization-examples.json`

## Included scenarios

- `greenhouse_structured_like`
- `workday_blob`
- `generic_html_like`

Each scenario stores:
- `raw`: source input that simulates crawler payload
- `normalized.nextColumns`: flattened DB columns derived from canonical output
- `normalized.canonical`: full canonical model with section confidence and provenance
- `normalized.pageView`: frontend detail-page contract
- `normalized.cardView`: frontend feed-card contract

## Why this helps

- Confirms section placement under the right canonical section.
- Shows confidence and review flags for noisy descriptions.
- Provides a stable fixture for debugging crawler regressions.
