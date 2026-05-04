/**
 * Offer negotiation intent detection — client-safe, no I/O.
 */

const OFFER_NEGOTIATION_RE =
  /\b(?:got\s+an?\s+offer|received\s+an?\s+offer|they\s+offered\s+me|evaluate\s+(?:this\s+)?offer|is\s+this\s+offer\s+(?:good|fair|competitive|reasonable)|should\s+i\s+negotiate|how\s+(?:do\s+i|to)\s+(?:negotiate|counter|counter.?offer)|how\s+much\s+(?:should\s+i\s+ask|can\s+i\s+get)|is\s+(?:this\s+)?(?:salary|compensation|pay)\s+(?:fair|good|competitive|reasonable|low|high)|negotiate\s+(?:my\s+)?(?:offer|salary|comp(?:ensation)?|package)|what\s+should\s+i\s+(?:ask\s+for|counter|negotiate|request)|counter.?offer|salary\s+negotiation|offer\s+review|review\s+(?:my\s+)?offer|below\s+market|above\s+market|market\s+(?:rate|salary|comp)|am\s+i\s+being\s+(?:underpaid|overpaid|fairly\s+paid)|help\s+me\s+negotiate)\b/i

export function isOfferNegotiationIntent(message: string): boolean {
  return OFFER_NEGOTIATION_RE.test(message.trim())
}
