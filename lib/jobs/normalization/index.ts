export {
  JOB_NORMALIZATION_VERSION,
} from "@/lib/jobs/normalization/types"

export type {
  CanonicalField,
  CanonicalJob,
  CanonicalSection,
  CanonicalSectionKey,
  ExplicitSponsorshipStatus,
  JobCardViewModel,
  JobPageSectionView,
  JobPageViewModel,
  NormalizationResult,
  NormalizationValidation,
  PersistedJobForNormalization,
  SourceAdapterKind,
  SourceRawJobInput,
  ValidationIssue,
} from "@/lib/jobs/normalization/types"

export {
  normalizeCrawlerJobForPersistence,
  normalizeCrawlerJobForPersistenceWithAI,
  normalizePersistedJobRecord,
  normalizePersistedJobRecordWithAI,
  readCanonicalFromRawData,
} from "@/lib/jobs/normalization/normalize"

export { resolveJobCardView, resolveJobNormalization } from "@/lib/jobs/normalization/read-model"
export type { ResolvedJobNormalization } from "@/lib/jobs/normalization/read-model"

export {
  mapCanonicalToJobCardView,
  mapCanonicalToJobPageView,
  formatEmploymentLabel,
  formatSeniorityLabel,
  formatSalaryLabel,
  formatDetectedTime,
} from "@/lib/jobs/normalization/view-model"
