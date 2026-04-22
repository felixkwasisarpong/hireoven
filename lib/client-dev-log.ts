/** Logs only in development - avoids noisy production consoles for expected failures (auth races, gated APIs). */

export function devWarn(...args: unknown[]) {
  if (process.env.NODE_ENV === "development") {
    console.warn(...args)
  }
}

export function devError(...args: unknown[]) {
  if (process.env.NODE_ENV === "development") {
    console.error(...args)
  }
}
