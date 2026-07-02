import Link from "next/link"
import { Users, Plus } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "./_lib/format"
import { ClientsToolbar } from "./_components/clients-toolbar"

export const dynamic = "force-dynamic"

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const supabase = await createClient()
  const { q: qParam } = await searchParams
  const q = (qParam ?? "").trim()

  let query = supabase
    .from("clients")
    .select("id, name, industry, source, created_at")
    .order("name", { ascending: true })
  if (q) query = query.ilike("name", `%${q}%`)

  const { data: clients } = await query
  const hasClients = (clients?.length ?? 0) > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Everyone you work with, and who to talk to."
      >
        <Button render={<Link href="/clients/new" />}>
          <Plus />
          New client
        </Button>
      </PageHeader>

      {hasClients || q ? <ClientsToolbar q={q} /> : null}

      {!clients || clients.length === 0 ? (
        q ? (
          <EmptyState
            icon={Users}
            title="No matching clients"
            description="No clients match your search. Try a different name."
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No clients yet"
            description="Add your first client to start tracking contacts, deals, and work."
            action={
              <Button render={<Link href="/clients/new" />}>
                <Plus />
                New client
              </Button>
            }
          />
        )
      ) : (
        <div className="rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/clients/${c.id}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.industry ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.source ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right">
                    {formatDate(c.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
