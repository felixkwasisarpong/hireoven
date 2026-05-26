import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default function ResumeGenerateRedirect() {
  redirect("/dashboard/resume/studio?mode=preview")
}
