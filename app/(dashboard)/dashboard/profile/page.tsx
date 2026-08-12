import { redirect } from "next/navigation"

// D8: the profile form lives at /dashboard/autofill (that path is hard-coded by
// the shipped Chrome extension, so it stays canonical). This alias gives the
// intuitive /dashboard/profile URL a home.
export default function ProfileAlias() {
  redirect("/dashboard/autofill")
}
