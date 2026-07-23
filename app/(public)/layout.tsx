import MarketingFooter from "@/components/marketing/MarketingFooter"

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#0a0e0c]">
      {children}
      <MarketingFooter />
    </div>
  )
}
