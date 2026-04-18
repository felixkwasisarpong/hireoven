import type { AutofillProfile } from "@/types"

/**
 * Lever uses input[name="name"] for full name, and specific URL field names.
 * Fields: name, email, phone, org, urls[LinkedIn], urls[GitHub], urls[Portfolio], comments
 */
export function getLeverPatches(profile: AutofillProfile): string {
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ")
  const patches: string[] = []

  if (fullName) {
    patches.push(`fillByName('name', ${JSON.stringify(fullName)});`)
  }
  if (profile.email) {
    patches.push(`fillByName('email', ${JSON.stringify(profile.email)});`)
  }
  if (profile.phone) {
    patches.push(`fillByName('phone', ${JSON.stringify(profile.phone)});`)
  }
  if (profile.linkedin_url) {
    patches.push(`fillByName('urls[LinkedIn]', ${JSON.stringify(profile.linkedin_url)});`)
    patches.push(`fillByName('urls[Linkedin]', ${JSON.stringify(profile.linkedin_url)});`)
  }
  if (profile.github_url) {
    patches.push(`fillByName('urls[GitHub]', ${JSON.stringify(profile.github_url)});`)
    patches.push(`fillByName('urls[Github]', ${JSON.stringify(profile.github_url)});`)
  }
  if (profile.portfolio_url) {
    patches.push(`fillByName('urls[Portfolio]', ${JSON.stringify(profile.portfolio_url)});`)
    patches.push(`fillByName('urls[Other]', ${JSON.stringify(profile.portfolio_url)});`)
  }

  return patches.join("\n  ")
}
