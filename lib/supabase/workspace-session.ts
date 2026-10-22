import { cookies } from "next/headers"
import { ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { workspaceCookieIsSecure } from "./workspace-cookie"

const ONE_YEAR = 60 * 60 * 24 * 365

export async function activateWorkspace(orgId: string) {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    secure: workspaceCookieIsSecure(process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV),
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  })
}
