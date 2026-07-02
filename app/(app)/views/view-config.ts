/**
 * Shared, framework-free helpers for turning a saved-view config (a small JSON
 * object of known filter keys) into a URL query string, and vice-versa. Used by
 * the server pages (to build "load view" links) and by the toolbars (to capture
 * the current filters before saving). Only known keys are emitted, so a saved
 * view can never inject arbitrary query params.
 */

/** The filter keys a saved view may carry. */
export const VIEW_FILTER_KEYS = ["stage", "status", "q"] as const
export type ViewFilterKey = (typeof VIEW_FILTER_KEYS)[number]

export type ViewConfig = Partial<Record<ViewFilterKey, string>>

/** Drop empty/blank values so we never persist or link `?stage=`. */
function clean(config: ViewConfig): ViewConfig {
  const out: ViewConfig = {}
  for (const key of VIEW_FILTER_KEYS) {
    const value = config[key]?.trim()
    if (value) out[key] = value
  }
  return out
}

/** Serialize a config to a query string like `stage=won&q=acme` (no leading `?`). */
export function configToQueryString(config: ViewConfig): string {
  const params = new URLSearchParams()
  const cleaned = clean(config)
  for (const key of VIEW_FILTER_KEYS) {
    if (cleaned[key]) params.set(key, cleaned[key]!)
  }
  return params.toString()
}

/** Same as above but with a leading `?`, or "" when there are no filters. */
export function configToHref(path: string, config: ViewConfig): string {
  const qs = configToQueryString(config)
  return qs ? `${path}?${qs}` : path
}

/** True when no filter is active. */
export function isEmptyConfig(config: ViewConfig): boolean {
  return Object.keys(clean(config)).length === 0
}
