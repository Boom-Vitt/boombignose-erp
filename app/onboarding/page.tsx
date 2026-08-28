import { redirect } from "next/navigation"

import { OnboardingForm } from "@/app/onboarding/onboarding-form"
import { safeRedirectPath } from "@/lib/auth/redirect"
import { createClient } from "@/lib/supabase/server"

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const intendedPath = safeRedirectPath(next)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(intendedPath)}`)

  const { data: memberships } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)

  if (memberships?.length) redirect(intendedPath)

  const metadataName = typeof user.user_metadata.workspace_name === "string" ? user.user_metadata.workspace_name : "My workspace"
  return <OnboardingForm defaultName={metadataName} next={intendedPath} />
}
