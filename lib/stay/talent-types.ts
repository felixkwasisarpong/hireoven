/** Client-safe talent constants/types — no server (pg) imports, so client forms
 *  can use them without pulling the DB layer into the browser bundle. */

export const TALENT_VISA_STATUS = ["f1_student", "opt", "stem_opt", "other"] as const
export type TalentVisaStatus = (typeof TALENT_VISA_STATUS)[number]

export const VISA_STATUS_LABEL: Record<TalentVisaStatus, string> = {
  f1_student: "F-1 student",
  opt: "F-1 OPT",
  stem_opt: "F-1 STEM OPT",
  other: "Other",
}
