import type { AutofillProfile } from "@/types"

/**
 * Ashby uses dynamic React-rendered forms. IDs are often generated.
 * We target by aria-label, placeholder, and label text instead.
 */
export function getAshbyPatches(profile: AutofillProfile): string {
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ")
  const patches: string[] = []

  if (profile.first_name) {
    patches.push(`fillByAriaLabel('First name', ${JSON.stringify(profile.first_name)});`)
    patches.push(`fillByPlaceholder('First name', ${JSON.stringify(profile.first_name)});`)
  }
  if (profile.last_name) {
    patches.push(`fillByAriaLabel('Last name', ${JSON.stringify(profile.last_name)});`)
    patches.push(`fillByPlaceholder('Last name', ${JSON.stringify(profile.last_name)});`)
  }
  if (fullName) {
    patches.push(`fillByAriaLabel('Full name', ${JSON.stringify(fullName)});`)
    patches.push(`fillByAriaLabel('Name', ${JSON.stringify(fullName)});`)
  }
  if (profile.email) {
    patches.push(`fillByAriaLabel('Email', ${JSON.stringify(profile.email)});`)
    patches.push(`fillByPlaceholder('Email address', ${JSON.stringify(profile.email)});`)
  }
  if (profile.phone) {
    patches.push(`fillByAriaLabel('Phone', ${JSON.stringify(profile.phone)});`)
    patches.push(`fillByAriaLabel('Phone number', ${JSON.stringify(profile.phone)});`)
  }
  if (profile.linkedin_url) {
    patches.push(`fillByAriaLabel('LinkedIn', ${JSON.stringify(profile.linkedin_url)});`)
    patches.push(`fillByAriaLabel('LinkedIn URL', ${JSON.stringify(profile.linkedin_url)});`)
  }
  if (profile.github_url) {
    patches.push(`fillByAriaLabel('GitHub', ${JSON.stringify(profile.github_url)});`)
    patches.push(`fillByAriaLabel('GitHub URL', ${JSON.stringify(profile.github_url)});`)
  }
  if (profile.portfolio_url) {
    patches.push(`fillByAriaLabel('Portfolio', ${JSON.stringify(profile.portfolio_url)});`)
    patches.push(`fillByAriaLabel('Website', ${JSON.stringify(profile.portfolio_url)});`)
  }

  return patches.join("\n  ")
}
