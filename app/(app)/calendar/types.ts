/** Colour token shared between day cells and the legend. */
export type CalendarTone =
  | "amber"
  | "violet"
  | "blue"
  | "neutral"
  | "red"
  | "emerald"

/** A single dated thing rendered on the calendar. `date` is ISO 'YYYY-MM-DD'. */
export type CalendarItem = {
  id: string
  date: string
  label: string
  tone: CalendarTone
  /** Optional deep-link to the underlying record. */
  href?: string
}
