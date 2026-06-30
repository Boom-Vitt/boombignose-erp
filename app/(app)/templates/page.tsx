import Link from "next/link"
import { Plus, Sparkles } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { NewCategoryDialog } from "./_components/new-category-dialog"
import { TemplatesLibrary, type TemplateCard } from "./_components/templates-library"

export const dynamic = "force-dynamic"

export default async function TemplatesPage() {
  await requireOrgContext()
  const supabase = await createClient()

  const [{ data: categories }, { data: templates }] = await Promise.all([
    supabase
      .from("template_categories")
      .select("id, name, slug")
      .order("name", { ascending: true }),
    supabase
      .from("automation_templates")
      .select(
        "id, name, description, internal_value_satang, price_satang, tags, category_id"
      )
      .order("name", { ascending: true }),
  ])

  const cards: TemplateCard[] = (templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    internalValueSatang: t.internal_value_satang,
    priceSatang: t.price_satang,
    tags: t.tags ?? [],
    categoryId: t.category_id,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        description="Your reusable automation playbooks — price them, tag them, ship them."
      >
        <NewCategoryDialog />
        <Button render={<Link href="/templates/new" />}>
          <Plus /> New template
        </Button>
      </PageHeader>

      {cards.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No templates yet"
          description="Capture your first reusable automation so you can quote and deliver it faster next time."
          action={
            <Button render={<Link href="/templates/new" />}>
              <Plus /> New template
            </Button>
          }
        />
      ) : (
        <TemplatesLibrary categories={categories ?? []} templates={cards} />
      )}
    </div>
  )
}
