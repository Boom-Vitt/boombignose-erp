import { Inbox, MailX } from "lucide-react"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"

import { LeadForm } from "./_components/lead-form"

// PUBLIC route (no session). Served with the service-role admin client, scoped
// strictly to the one org resolved from the public slug. Never cache.
export const dynamic = "force-dynamic"

function NotAccepting() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="bg-muted flex size-12 items-center justify-center rounded-full">
        <MailX className="text-muted-foreground size-5" />
      </div>
      <h1 className="text-xl font-semibold">Not accepting leads</h1>
      <p className="text-muted-foreground text-sm">
        This form isn&apos;t taking submissions right now. Please check back
        later or reach out through another channel.
      </p>
    </main>
  )
}

export default async function LeadCapturePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!slug) return <NotAccepting />

  const supabase = createAdminClient()

  // Resolve the slug → org. Only opted-in orgs resolve; a missing or disabled
  // org renders the same generic page (no existence leak).
  const { data: org, error } = await supabase
    .from("organizations")
    .select("name")
    .eq("slug", slug)
    .eq("lead_capture_enabled", true)
    .maybeSingle()

  if (error || !org) return <NotAccepting />

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-10">
      <Card>
        <CardHeader className="space-y-2 text-center">
          <div className="bg-primary/10 mx-auto flex size-11 items-center justify-center rounded-full">
            <Inbox className="text-primary size-5" />
          </div>
          <CardTitle className="text-xl">Get in touch with {org.name}</CardTitle>
          <CardDescription>
            Tell us a little about yourself and we&apos;ll be in touch shortly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadForm slug={slug} />
        </CardContent>
      </Card>
    </main>
  )
}
