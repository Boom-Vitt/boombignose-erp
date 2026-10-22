import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { parseFacets, type FacetList } from "@/lib/search-facets"
import type { SavedView } from "@/app/(app)/views/saved-views-menu"

export async function getFacetSavedViews(list: FacetList): Promise<SavedView[]> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data, error } = await supabase.from("saved_views").select("id,name,config")
    .eq("org_id", ctx.orgId).eq("user_id", ctx.userId).eq("module", list).order("created_at")
  if (error) throw new Error("Saved views unavailable. Please reload.")
  return (data ?? []).map((view) => ({ ...view, config: parseFacets(new URLSearchParams(
    Object.entries(typeof view.config === "object" && !Array.isArray(view.config) ? view.config : {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  ), list) }))
}
