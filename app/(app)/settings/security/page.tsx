import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { totpEnrollEnabled } from "@/lib/auth/totp"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { EnrollTotp } from "./enroll-totp"

export const dynamic = "force-dynamic"

export default async function SecuritySettingsPage() {
  await requireOrgContext()
  const enabled = totpEnrollEnabled(process.env.LOCAL_TOTP_ENROLL)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Authenticator"
        description="Optional second step for this local account. Other pages stay available."
      />
      <p className="text-sm">
        <Link href="/settings" className="underline">
          Back to settings
        </Link>
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">TOTP</CardTitle>
          <CardDescription>
            Enrollment uses the local GoTrue API. It does not call a cloud model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {enabled ? (
            <EnrollTotp />
          ) : (
            <p>
              Enrollment is off. Set LOCAL_TOTP_ENROLL=1 on the ERP server to
              open this screen. The committed local Supabase config allows TOTP
              enroll and verify. A stack that was already running needs a
              restart before the API accepts a factor. Password sign-in stays
              available, and an aal1 session is not rejected.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
