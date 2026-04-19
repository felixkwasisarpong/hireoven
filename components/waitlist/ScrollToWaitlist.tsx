"use client"

type Props = {
  className?: string
  children: React.ReactNode
  /** Input to focus after scroll */
  emailInputId?: string
}

export default function ScrollToWaitlist({
  className,
  children,
  emailInputId = "waitlist-email-hero",
}: Props) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        document.getElementById("launch-waitlist-form")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        })
        window.setTimeout(() => {
          document.getElementById(emailInputId)?.focus()
        }, 400)
      }}
    >
      {children}
    </button>
  )
}
