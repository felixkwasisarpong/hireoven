const AUTONOMOUS_HUNT_RE = /\b(autonomous\s+hunt|hunt\s+mode|attack\s+plan|today'?s\s+attack\s+plan|build\s+my\s+attack\s+plan|build\s+today'?s\s+hunt|run\s+autonomous\s+hunt|run\s+hunt\s+mode|top\s+of\s+the\s+queue|where\s+should\s+i\s+focus\s+today|what\s+should\s+i\s+do\s+next\s+(?:today|this\s+week)|highest-?conviction\s+batch)\b/i

export function isAutonomousHuntIntent(message: string): boolean {
  return AUTONOMOUS_HUNT_RE.test(message.trim())
}
