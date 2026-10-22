import { sumSatang, type Satang } from "@/lib/money"

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
}

export type KanbanGroup<S extends string = string> = KanbanColumn<S> & {
  cards: KanbanCard<S>[]
  sumSatang: Satang
}

/** Buckets cards into columns (column order, card order kept). Cards in an unknown stage are dropped. */
export function groupCards<S extends string>(
  columns: readonly KanbanColumn<S>[],
  cards: readonly KanbanCard<S>[]
): KanbanGroup<S>[] {
  return columns.map((column) => {
    const inColumn = cards.filter((c) => c.stage === column.id)
    return {
      ...column,
      cards: inColumn,
      sumSatang: sumSatang(inColumn.map((c) => c.amountSatang ?? 0)),
    }
  })
}

/**
 * Optimistic stage move. Pure: the input list is never mutated, so dropping the
 * optimistic layer (server rejected the move) renders the untouched list again.
 */
export function moveCard<S extends string>(
  cards: readonly KanbanCard<S>[],
  id: string,
  to: S
): readonly KanbanCard<S>[] {
  const card = cards.find((c) => c.id === id)
  if (!card || card.stage === to) return cards
  // Moved cards go to the top of the target column, like a fresh drop.
  return [{ ...card, stage: to }, ...cards.filter((c) => c.id !== id)]
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

export function dueState(due: string, today: string): DueState {
  return due < today ? "overdue" : due === today ? "today" : "planned"
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
