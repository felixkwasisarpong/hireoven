import MarketingFooter from "@/components/marketing/MarketingFooter"

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--term-bg)]">
      {children}
      <MarketingFooter />
    </div>
  )
}
