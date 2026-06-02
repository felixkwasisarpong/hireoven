export type SignalApiRateLimitState = {
  limit: number
  remaining: number
  reset: number
  windowSeconds: number
  allowed: boolean
}

export type SignalApiQuotaState = {
  planName: string
  enforce: boolean
  dailyLimit: number | null
  dailyUsed: number
  dailyRemaining: number | null
  dailyReset: number
  monthlyLimit: number | null
  monthlyUsed: number
  monthlyRemaining: number | null
  monthlyReset: number
  allowed: boolean
}

export type SignalApiAuthContext = {
  requestId: string
  apiKeyId: string
  tenantId: string
  scopes: string[]
  subjectUserId: string | null
  rateLimit: SignalApiRateLimitState
  quota: SignalApiQuotaState
}

export type SignalApiEnvKey = {
  key: string
  keyId?: string
  tenantId: string
  scopes?: string[]
  defaultUserId?: string
  disabled?: boolean
}
