import CompanyProfilePageClient from "./CompanyProfilePageClient"

export const dynamic = "force-dynamic"

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <CompanyProfilePageClient companyId={id} />
}
