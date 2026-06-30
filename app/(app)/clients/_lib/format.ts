import { formatInTimeZone } from "date-fns-tz"

import { APP_TZ } from "@/lib/dates"

/** Human date like "30 Jun 2026" in the app timezone. Null/empty → "—". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  return formatInTimeZone(new Date(value), APP_TZ, "d MMM yyyy")
}
