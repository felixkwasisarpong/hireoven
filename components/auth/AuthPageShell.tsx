import type { ReactNode } from "react"

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="auth-form-card w-full max-w-md p-8 sm:p-9">{children}</div>
    </main>
  )
}
