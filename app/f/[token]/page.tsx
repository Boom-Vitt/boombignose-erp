import type { Metadata } from "next"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { buttonVariants } from "@/components/ui/button"
import { LEAD_ERRORS } from "@/lib/lead-forms/input"
import { publicLeadForm } from "@/lib/lead-forms/server"
import { submitLead } from "./actions"
import LeadFormUnavailable from "./unavailable"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Contact us", robots: { index: false, follow: false }, referrer: "same-origin" }

export default async function LeadFormPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { token } = await params
  const { result } = await searchParams
  let form
  try {
    form = await publicLeadForm(token)
  } catch {
    return <main className="mx-auto max-w-lg p-6"><h1 className="text-xl font-semibold">Please try again later</h1><p>{LEAD_ERRORS.error}</p></main>
  }
  if (!form) return <LeadFormUnavailable />
  const error = result && Object.hasOwn(LEAD_ERRORS, result) ? LEAD_ERRORS[result as keyof typeof LEAD_ERRORS] : null

  return (
    <main className="mx-auto max-w-lg space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{form.name}</h1>
      {result === "success" ? (
        <p role="status" className="rounded-lg border p-4">{form.success_message}</p>
      ) : (
        <>
          <p className="text-muted-foreground">Send us a message and our team will get back to you.</p>
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
          <form action={submitLead.bind(null, token)} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" autoComplete="name" required maxLength={120} /></div>
            <div className="space-y-2"><Label htmlFor="company">Company (optional)</Label><Input id="company" name="company" autoComplete="organization" maxLength={200} /></div>
            <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} /></div>
            <div className="space-y-2"><Label htmlFor="phone">Phone (optional)</Label><Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={50} /></div>
            <div className="space-y-2"><Label htmlFor="message">Message</Label><Textarea id="message" name="message" required maxLength={4000} rows={5} /></div>
            <div hidden aria-hidden="true"><label htmlFor="website">Leave this field empty</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
            <button type="submit" className={buttonVariants()}>Send message</button>
          </form>
        </>
      )}
    </main>
  )
}
