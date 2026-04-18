import type { AutofillProfile } from "@/types"

/**
 * Generates Greenhouse-specific field patches for the browser fill script.
 * Greenhouse uses predictable IDs: #first_name, #last_name, #email, #phone, #resume
 */
export function getGreenhousePatches(profile: AutofillProfile): string {
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ")
  const patches: string[] = []

  if (profile.first_name) {
    patches.push(`fillById('first_name', ${JSON.stringify(profile.first_name)});`)
    patches.push(`fillById('candidate_first_name', ${JSON.stringify(profile.first_name)});`)
  }
  if (profile.last_name) {
    patches.push(`fillById('last_name', ${JSON.stringify(profile.last_name)});`)
    patches.push(`fillById('candidate_last_name', ${JSON.stringify(profile.last_name)});`)
  }
  if (fullName) {
    patches.push(`fillByName('job_application[name]', ${JSON.stringify(fullName)});`)
  }
  if (profile.email) {
    patches.push(`fillById('email', ${JSON.stringify(profile.email)});`)
    patches.push(`fillByName('job_application[email]', ${JSON.stringify(profile.email)});`)
  }
  if (profile.phone) {
    patches.push(`fillById('phone', ${JSON.stringify(profile.phone)});`)
    patches.push(`fillByName('job_application[phone]', ${JSON.stringify(profile.phone)});`)
  }
  if (profile.linkedin_url) {
    patches.push(`fillByName('job_application[urls][LinkedIn]', ${JSON.stringify(profile.linkedin_url)});`)
    patches.push(`fillBySelector('input[id*="linkedin"]', ${JSON.stringify(profile.linkedin_url)});`)
  }
  if (profile.github_url) {
    patches.push(`fillByName('job_application[urls][GitHub]', ${JSON.stringify(profile.github_url)});`)
  }
  if (profile.portfolio_url) {
    patches.push(`fillByName('job_application[urls][Portfolio]', ${JSON.stringify(profile.portfolio_url)});`)
  }
  if (profile.city) {
    patches.push(`fillByName('job_application[location]', ${JSON.stringify([profile.city, profile.state].filter(Boolean).join(', '))});`)
  }

  return patches.join("\n  ")
}
