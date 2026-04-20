import { z } from "zod"

const emailSchema = z.string().email()
const vapidEmailSchema = z
  .string()
  .refine((value) => {
    if (value.startsWith("mailto:")) {
      return emailSchema.safeParse(value.slice("mailto:".length)).success
    }

    return emailSchema.safeParse(value).success
  }, {
    message: "VAPID_EMAIL must be a valid email or mailto: email",
  })
  .transform((value) => (value.startsWith("mailto:") ? value : `mailto:${value}`))

const envSchema = z.object({
  // Supabase — get from: supabase.com → project settings → API
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  // Anthropic — get from: console.anthropic.com → API keys
  ANTHROPIC_API_KEY: z
    .string()
    .refine((v) => v.startsWith("sk-ant-"), {
      message: "ANTHROPIC_API_KEY must start with 'sk-ant-'",
    })
    .optional(),

  // Resend — get from: resend.com → API keys
  RESEND_API_KEY: z
    .string()
    .refine((v) => v.startsWith("re_"), {
      message: "RESEND_API_KEY must start with 're_'",
    })
    .optional(),

  // Web Push VAPID — generate with: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_EMAIL: vapidEmailSchema.optional(),

  // Security — generate with: openssl rand -base64 32
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters").optional(),
  SUPABASE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // App URL
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Optional
  ADMIN_EMAIL: z.string().email().optional(),
  SENTRY_DSN: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
})

type Env = z.infer<typeof envSchema>

function parseEnv() {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")

    throw new Error(
      `\n\n🔴 Environment variable validation failed:\n${formatted}\n\n` +
        `Copy .env.production.example to .env.local and fill in the values.\n`
    )
  }

  return result.data
}

let cachedEnv: Env | null = null

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv()
  }
  return cachedEnv
}

export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    return getEnv()[prop as keyof Env]
  },
})

export function requireCronAuth(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV === "development"
  return authHeader === `Bearer ${secret}`
}

export function requireWebhookAuth(signatureHeader: string | null): boolean {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET
  if (!secret) return process.env.NODE_ENV === "development"
  return signatureHeader === secret
}
