import type { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { OPEN_STAGES } from "@/lib/metrics/pipeline"

export type DealOption = { value: string; label: string; clientId: string }

/** Deals a quote can link to: every open deal, plus the one it already links to. */
export async function dealOptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  current?: string | null
): Promise<DealOption[]> {
  const open = await readAllOrThrow((from, to) =>
    supabase
      .from("deals")
      .select("id,title,client_id")
      .eq("org_id", orgId)
      .in("stage", OPEN_STAGES)
      .order("title")
      .order("id")
      .range(from, to)
  )
  const linked =
    current && !open.some((d) => d.id === current)
      ? (await supabase.from("deals").select("id,title,client_id").eq("org_id", orgId).eq("id", current).maybeSingle()).data
      : null
  return [...(linked ? [linked] : []), ...open].map((d) => ({ value: d.id, label: d.title, clientId: d.client_id }))
}
