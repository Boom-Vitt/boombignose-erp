import { readAll } from "@/lib/supabase/read-all"

export async function allPurchasingRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await readAll(read)
  if (error) throw new Error(error.message)
  return data ?? []
}
