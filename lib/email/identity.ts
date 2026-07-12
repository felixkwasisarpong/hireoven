function getSupportDomain() {
  // MUST be a Resend-verified domain or every send throws "domain is not
  // verified". Only the root `hireoven.com` is verified (DMARC added 2026-07-05);
  // the `support.hireoven.com` subdomain never was, which silently broke ALL
  // alert emails (alerts@support.hireoven.com → rejected). Default to the
  // verified root; override via MAIL_FROM_DOMAIN once a subdomain is verified.
  return process.env.MAIL_FROM_DOMAIN ?? "hireoven.com"
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
