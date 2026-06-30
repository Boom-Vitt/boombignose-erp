import { redirect } from "next/navigation"

export default function Home() {
  // Middleware sends unauthenticated users to /login; authenticated to dashboard.
  redirect("/dashboard")
}
