import { sumSatang, type Satang } from "@/lib/money"
import { expectedRevenue } from "@/lib/metrics/pipeline"

/** One board column, keyed by the record's stage/status enum value. */
export type KanbanColumn<S extends string = string> = {
  id: S
  label: string
  foldedByDefault?: boolean
}

export type KanbanCard<S extends string = string> = {
  id: string
  stage: S
  title: string
  href: string
  amountSatang: Satang | null
  client: string | null
  owner: string | null
  /** YYYY-MM-DD of the next open activity, if any. */
  due: string | null
  /** Win probability in whole percent, for boards that weigh their amounts. */
  probability?: number
}

export type KanbanGroup<S extends string = string> = KanbanColumn<S> & {
  cards: KanbanCard<S>[]
  sumSatang: Satang
  /** Sum of amount x probability; null when no card in the column carries a probability. */
  expectedSatang: Satang | null
}

/** Buckets cards into columns (column order, card order kept). Cards in an unknown stage are dropped. */
export function groupCards<S extends string>(
  columns: readonly KanbanColumn<S>[],
  cards: readonly KanbanCard<S>[]
): KanbanGroup<S>[] {
  return columns.map((column) => {
    const inColumn = cards.filter((c) => c.stage === column.id)
    const weighted = inColumn.filter((c) => c.probability !== undefined)
    return {
      ...column,
      cards: inColumn,
      sumSatang: sumSatang(inColumn.map((c) => c.amountSatang ?? 0)),
      expectedSatang: weighted.length
        ? sumSatang(weighted.map((c) => expectedRevenue({ value_satang: c.amountSatang ?? 0, probability: c.probability! })))
        : null,
    }
  })
}

const columnIds = <S extends string>(cards: readonly KanbanCard<S>[], stage: S) =>
  cards.filter((c) => c.stage === stage).map((c) => c.id)

/**
 * Optimistic move: the card goes right after `after` in column `to`, or to the top of it when
 * `after` is null or no longer there (the server's move_deal does the same). Pure: the input list
 * is never mutated, so dropping the optimistic layer renders the untouched list again.
 */
export function moveCard<S extends string>(
  cards: readonly KanbanCard<S>[],
  id: string,
  to: S,
  after: string | null = null
): readonly KanbanCard<S>[] {
  const card = cards.find((c) => c.id === id)
  if (!card) return cards
  const rest = cards.filter((c) => c.id !== id)
  const anchor = after === null ? -1 : rest.findIndex((c) => c.id === after && c.stage === to)
  const top = rest.findIndex((c) => c.stage === to)
  const at = anchor >= 0 ? anchor + 1 : Math.max(top, 0)
  const next = [...rest.slice(0, at), { ...card, stage: to }, ...rest.slice(at)]
  const unchanged = card.stage === to && columnIds(next, to).join() === columnIds(cards, to).join()
  return unchanged ? cards : next
}

/** The card a drop lands after: the hovered card on its lower half, else the one above it. */
export function afterForDrop(ids: readonly string[], overId: string, below: boolean): string | null {
  const i = ids.indexOf(overId)
  return below ? overId : (ids[i - 1] ?? null)
}

/** `after` for a one-step keyboard reorder; undefined when the card is already at that edge. */
export function reorderAfter(ids: readonly string[], id: string, direction: "up" | "down"): string | null | undefined {
  const i = ids.indexOf(id)
  if (i < 0) return undefined
  if (direction === "up") return i === 0 ? undefined : (ids[i - 2] ?? null)
  return i === ids.length - 1 ? undefined : ids[i + 1]
}

/** Runs async tasks strictly one at a time in call order; a failure only rejects its own caller. */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
}

/**
 * Focus for a card moved from its "Move to…" menu, decided after each render. The card stays
 * followed until the move settles: a rejected move remounts it in its old column after the
 * optimistic render, which drops focus again. Focus moves only when it was lost to the page body.
 */
export function movedCardFocus<S extends string>(
  followId: string | null,
  cards: readonly KanbanCard<S>[],
  { pending, focusLost }: { pending: boolean; focusLost: boolean }
): { selectors: string[]; followId: string | null } {
  const card = followId ? cards.find((c) => c.id === followId) : undefined
  if (!card) return { selectors: [], followId: null }
  return {
    // The card's own menu button, or its column's strip when that column is folded.
    selectors: focusLost ? [`[data-card="${card.id}"] [data-move]`, `[data-unfold="${card.stage}"]`] : [],
    followId: pending ? card.id : null,
  }
}

export type DueState = "overdue" | "today" | "planned"
/** A card's next-activity state, "none" when it has no open activity. */
export type ActivityState = DueState | "none"

export function dueState(due: string, today: string): DueState {
  return due < today ? "overdue" : due === today ? "today" : "planned"
}

const activityState = (card: KanbanCard, today: string): ActivityState =>
  card.due ? dueState(card.due, today) : "none"

export function activityCounts(cards: readonly KanbanCard[], today: string): Record<ActivityState, number> {
  const counts = { overdue: 0, today: 0, planned: 0, none: 0 }
  for (const card of cards) counts[activityState(card, today)]++
  return counts
}

export function filterByDue<C extends KanbanCard>(cards: readonly C[], state: ActivityState, today: string): C[] {
  return cards.filter((card) => activityState(card, today) === state)
}

/** True when any quick-create field holds non-blank text, so Escape must not silently drop it. */
export function hasTypedInput(entries: Iterable<[string, FormDataEntryValue]>): boolean {
  for (const [, value] of entries) if (typeof value === "string" && value.trim() !== "") return true
  return false
}

/** Earliest of the given YYYY-MM-DD dates, ignoring nulls. */
export function earliestDate(dates: readonly (string | null)[]): string | null {
  let min: string | null = null
  for (const d of dates) if (d && (min === null || d < min)) min = d
  return min
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  // Thai leading vowels (เ แ โ ใ ไ) are written before the first consonant.
  return letters
    .map((p) => p.replace(/^[เ-ไ]/, "").charAt(0).toUpperCase())
    .join("")
}

/** Parses a stored fold list; anything that isn't an array of strings is ignored. */
export function parseFolded(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? value
      : null
  } catch {
    return null
  }
}
