const BURNOUT_CHECKIN_RE =
  /\b(?:i\s+feel\s+(?:stuck|lost|overwhelmed|exhausted|burnt?\s*out|defeated|hopeless|demoralized|like\s+giving\s+up)|this\s+is\s+(?:exhausting|overwhelming|so\s+hard|too\s+much|draining)|i\s+(?:want\s+to|feel\s+like|might)\s+give\s+up|nothing\s+is\s+working|i\s+haven'?t\s+applied\s+(?:in|for)|i\s+(?:stopped|haven'?t\s+been)\s+applying|where\s+do\s+i\s+even\s+start|i\s+don'?t\s+know\s+(?:what\s+to\s+do|where\s+to\s+start|how\s+to\s+keep\s+going)|should\s+i\s+(?:take\s+a\s+break|pause|stop)|i'?m\s+(?:losing|lost)\s+(?:hope|motivation|momentum|steam)|job\s+search\s+(?:is\s+killing|has\s+me)|not\s+getting\s+(?:any|any\s+)?responses?|nobody\s+is\s+(?:responding|calling\s+back)|been\s+searching\s+for\s+(?:months|weeks|a\s+long\s+time))\b/i

export function isBurnoutCheckinIntent(message: string): boolean {
  return BURNOUT_CHECKIN_RE.test(message.trim())
}
