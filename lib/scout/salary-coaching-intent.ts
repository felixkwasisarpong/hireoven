const SALARY_COACHING_RE =
  /\b(?:am\s+i\s+(?:being\s+)?(?:underpaid|paid\s+fairly|undervalued|underselling\s+myself)|what\s+should\s+i\s+(?:be\s+making|be\s+earning|ask\s+for|say\s+(?:when\s+they\s+ask|about\s+salary))|is\s+(?:this\s+salary|my\s+salary|my\s+pay|my\s+comp(?:ensation)?)\s+(?:good|fair|competitive|reasonable|low|high|market\s+rate)|salary\s+(?:coaching|advice|expectations?|help|guidance)|what\s+(?:should\s+i\s+be\s+paid|is\s+(?:market\s+rate|fair)|do\s+i\s+say\s+(?:when|if)\s+(?:they\s+ask|recruiter))|my\s+(?:salary\s+floor|minimum\s+salary|salary\s+target)|how\s+much\s+(?:should\s+i\s+(?:make|be\s+making|ask)|can\s+i\s+(?:negotiate|ask\s+for|expect))|am\s+i\s+targeting\s+(?:the\s+right|enough|too\s+low)|underselling|below\s+(?:my\s+)?market\s+(?:rate|value)|salary\s+too\s+low|underpaid)\b/i

export function isSalaryCoachingIntent(message: string): boolean {
  return SALARY_COACHING_RE.test(message.trim())
}
