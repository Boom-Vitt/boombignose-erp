import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ClientForm } from "../../_components/client-form"
import { updateClient } from "../../actions"

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, industry, source, notes")
    .eq("id", id)
    .maybeSingle()

  if (!client) notFound()

  // Bind the client id so the shared form keeps its (values) => {...} shape.
  const updateAction = updateClient.bind(null, client.id)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="Edit client"
        description={`Update ${client.name}'s details.`}
      >
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/clients/${client.id}`} />}
        >
          <ArrowLeft />
          Back
        </Button>
      </PageHeader>

      <Card>
        <CardContent>
          <ClientForm
            action={updateAction}
            submitLabel="Save changes"
            defaultValues={{
              name: client.name,
              industry: client.industry ?? "",
              source: client.source ?? "",
              notes: client.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
