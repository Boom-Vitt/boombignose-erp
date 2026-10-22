import type { createClient } from "@/lib/supabase/server"

/**
 * Display names for user ids. `projects.owner` and `project_tasks.assignee`
 * reference auth.users (no PostgREST FK to profiles), so fetch the profiles
 * separately. RLS only exposes co-members, so unknown ids are simply absent.
 */
export async function profileNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: Array<string | null>
) {
  const unique = Array.from(new Set(ids.filter((v): v is string => !!v)))
  const names = new Map<string, string>()
  if (unique.length === 0) return names
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", unique)
  for (const p of data ?? []) {
    if (p.full_name) names.set(p.id, p.full_name)
  }
  return names
}
