"use client"

import { track as vercelTrack } from "@vercel/analytics"

export function track(event: string, properties?: Record<string, string | number | boolean>) {
  try {
    vercelTrack(event, properties)
  } catch {
    // Analytics should never break the app
  }
}

// Typed event helpers - call these throughout the app

export function trackJobViewed(jobId: string, companyId: string, source: string) {
  track("job_viewed", { jobId, companyId, source })
}

export function trackJobApplied(jobId: string, companyId: string, freshnessMinutes: number) {
  track("job_applied", { jobId, companyId, freshnessMinutes })
}

export function trackAlertCreated(params: {
  keywords: string
  hasSponsorship: boolean
  isInternational: boolean
}) {
  track("alert_created", params)
}

export function trackCompanyWatched(companyId: string) {
  track("company_watched", { companyId })
}

export function trackSignupCompleted(params: {
  visaStatus: string
  isInternational: boolean
}) {
  track("signup_completed", params)
}

export function trackOnboardingCompleted(stepsCompleted: number) {
  track("onboarding_completed", { stepsCompleted })
}
