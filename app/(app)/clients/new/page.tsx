import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ClientForm } from "../_components/client-form"
import { createClient } from "../actions"

export default function NewClientPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader title="New client" description="Add someone you work with.">
        <Button variant="ghost" size="sm" render={<Link href="/clients" />}>
          <ArrowLeft />
          Back
        </Button>
      </PageHeader>

      <Card>
        <CardContent>
          <ClientForm
            action={createClient}
            submitLabel="Create client"
            redirectsOnSuccess
          />
        </CardContent>
      </Card>
    </div>
  )
}
