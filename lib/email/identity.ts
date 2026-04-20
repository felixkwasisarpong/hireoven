function getSupportDomain() {
  return process.env.MAIL_FROM_DOMAIN ?? "support.hireoven.com"
}

function formatFrom(displayName: string, email: string) {
  return `${displayName} <${email}>`
}

export function getSupportFromEmail() {
  if (process.env.RESEND_FROM_EMAIL) {
    return process.env.RESEND_FROM_EMAIL
  }

  return formatFrom("Hireoven Support", `support@${getSupportDomain()}`)
}

export function getAlertsFromEmail() {
  if (process.env.RESEND_FROM_EMAIL) {
    return process.env.RESEND_FROM_EMAIL
  }

  return formatFrom("Hireoven Alerts", `alerts@${getSupportDomain()}`)
}

export function getWaitlistFromEmail() {
  if (process.env.RESEND_FROM_EMAIL) {
    return process.env.RESEND_FROM_EMAIL
  }

  return formatFrom("Hireoven", `hello@${getSupportDomain()}`)
}

export function getRecentJobsFromEmail() {
  return process.env.RECENT_JOBS_FROM_EMAIL ?? "Hireoven Jobs <hello@hireoven.com>"
}
