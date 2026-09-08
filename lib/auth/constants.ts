/** HttpOnly session JWT cookie name */
export const SESSION_COOKIE_NAME = "ho_session"

/**
 * Short-lived cache of the account flags the middleware enforces (admin,
 * suspended). The session JWT cannot be trusted for `suspended`: it is signed
 * at login and lives for 14 days, so a user suspended afterwards would carry
 * `suspended: false` until it expired. The middleware therefore re-reads the
 * flags from Postgres, and parks the answer here so that costs one lookup per
 * user per minute rather than one per request.
 */
export const SESSION_FLAGS_COOKIE_NAME = "ho_flags"

/** How stale the cached flags may get — i.e. the worst-case kick-out delay. */
export const SESSION_FLAGS_TTL_SECONDS = 60
