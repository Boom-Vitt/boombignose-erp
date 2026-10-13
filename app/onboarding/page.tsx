import { redirect } from "next/navigation"
import { getAuthenticatedUser, getOrgContext } from "@/lib/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { signOutTo } from "./actions"
import { WorkspaceForm } from "./workspace-form"

export const dynamic = "force-dynamic"

export default async function OnboardingPage() {
  const user = await getAuthenticatedUser()
  if (!user) redirect("/login?redirect=%2Fonboarding")
  if (await getOrgContext()) redirect("/dashboard")

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your workspace / สร้างพื้นที่ทำงาน</CardTitle>
          <CardDescription>Your account is ready. Create a workspace to begin, or open your teammate’s invitation link.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground text-sm">Signed in as <span className="font-medium">{user.email}</span></p>
          <WorkspaceForm userId={user.id} />
          <form action={signOutTo.bind(null, "/onboarding")}>
            <Button type="submit" variant="outline" className="w-full">Use another account</Button>
          </form>
          <p className="text-muted-foreground text-sm">Joining an existing team? Open its invitation link while signed in with the email address that received it.</p>
        </CardContent>
      </Card>
    </div>
  )
}
