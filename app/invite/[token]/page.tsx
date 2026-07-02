import Link from "next/link"
import { redirect } from "next/navigation"
import { Sparkles, MailWarning } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"

import { AcceptInvitationButton } from "./accept-button"

export const dynamic = "force-dynamic"

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // Must be signed in to accept (middleware also guards this route).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=/invite/${token}`)

  // The invitee is not yet a member, so read the invitation with the
  // service-role client (RLS would hide it). Read-only lookup for display.
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from("invitations")
    .select("email, role, status, expires_at, org_id")
    .eq("token", token)
    .maybeSingle()

  let orgName = "a workspace"
  if (invite) {
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", invite.org_id)
      .maybeSingle()
    if (org?.name) orgName = org.name
  }

  const isValid =
    invite &&
    invite.status === "pending" &&
    (!invite.expires_at || invite.expires_at >= new Date().toISOString())

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary text-primary-foreground mb-2 flex size-10 items-center justify-center rounded-md">
            {isValid ? (
              <Sparkles className="size-5" />
            ) : (
              <MailWarning className="size-5" />
            )}
          </div>
          <CardTitle>
            {isValid ? `Join ${orgName}` : "Invitation unavailable"}
          </CardTitle>
          <CardDescription>
            {isValid
              ? `You've been invited to join ${orgName} as ${invite!.role} on BoomBigNose Company OS.`
              : "This invitation link is invalid, already used, revoked, or expired."}
          </CardDescription>
        </CardHeader>

        {isValid ? (
          <>
            <CardContent>
              <p className="text-muted-foreground text-center text-sm">
                Signed in as <span className="font-medium">{user.email}</span>
              </p>
            </CardContent>
            <CardFooter>
              <AcceptInvitationButton token={token} />
            </CardFooter>
          </>
        ) : (
          <CardFooter>
            <Button variant="outline" className="w-full" render={<Link href="/dashboard" />}>
              Go to dashboard
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
