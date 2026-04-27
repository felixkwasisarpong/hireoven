import { redirect } from "next/navigation"

export default function ResumeGenerateRedirect() {
  redirect("/dashboard/resume/studio?mode=preview")
}