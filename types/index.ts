export interface User {
  id: string
  email: string
  createdAt: string
}

export interface Company {
  id: string
  name: string
  careersUrl: string
  logoUrl: string | null
  lastCrawledAt: string | null
}

export interface Job {
  id: string
  companyId: string
  title: string
  url: string
  location: string | null
  sponsorship: boolean
  detectedAt: string
  isActive: boolean
}

export interface Alert {
  id: string
  userId: string
  keywords: string[]
  locations: string[]
  sponsorshipOnly: boolean
  createdAt: string
}

export interface EarlyAccessSubmission {
  email: string
  submittedAt: string
}
