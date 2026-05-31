import Anthropic from "@anthropic-ai/sdk"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import type { ScoredConnection } from "./scorer"

const anthropic = new Anthropic()

export async function generateDM(
  connection: ScoredConnection,
  jobTitle: string,
  companyName: string,
  candidateName: string,
  candidateHeadline: string,
): Promise<string> {
  const prompt = `You are writing a LinkedIn DM for ${candidateName} (${candidateHeadline}) who wants a referral at ${companyName}.

TARGET CONTACT:
- Name: ${connection.name}
- Title: ${connection.title}
- Company: ${connection.company}
- Connection degree: ${connection.degree}st/nd/rd degree
- Recently active on LinkedIn: ${connection.recentlyActive}
- Mutual connections: ${connection.mutualCount}

ROLE THEY'RE APPLYING FOR: ${jobTitle} at ${companyName}

Write a LinkedIn DM that:
1. Opens with a SPECIFIC hook (reference their actual title/work, don't be generic)
2. Makes the ask clear and easy to say yes to (just pass along my resume, not a big favor)
3. Shows genuine interest in ${companyName}, not just job hunting desperation
4. Ends with a soft CTA that requires zero effort to respond to
5. Is under 150 words
6. Sounds human, not AI-generated

Do NOT use:
- "I hope this message finds you well"
- "I'm reaching out because..."
- "Would love to connect"
- Any cringe openers
- Em dashes or en dashes (— or –). Use commas, periods, or "to" for ranges instead. This is critical: NO dashes of any kind.

Return ONLY the message text. No subject line, no labels.`

  try {
    const msg = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    })
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : ""
    return stripDashes(raw)
  } catch {
    return stripDashes(`Hi ${connection.name.split(" ")[0]}, I noticed you're at ${companyName} as ${connection.title}. I'm applying for the ${jobTitle} role there and would really appreciate a quick referral or even just your honest take on the team. Happy to share my resume. No pressure either way!`)
  }
}

/**
 * Remove em/en dashes from generated text. Replaces " — " separators with
 * ", " and bare dashes with commas so the sentence still reads naturally.
 */
function stripDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")  // " — " → ", "
    .replace(/,\s*,/g, ",")         // collapse any double commas
    .replace(/,\s*\./g, ".")        // ", ." → "."
    .trim()
}
