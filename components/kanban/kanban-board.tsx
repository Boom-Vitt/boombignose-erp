"use client"

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronsLeftRight, ChevronsRightLeft, Plus, X } from "lucide-react"
import { toast } from "sonner"

import { groupCards, moveCard, type KanbanCard as Card, type KanbanColumn, type KanbanGroup } from "@/lib/kanban"
import { formatTHBWhole } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { KanbanCard } from "./kanban-card"
import { useFoldedColumns } from "./use-folded-columns"

type Result = { error?: string }

/** What the quick-create card holds; `form` carries any extra named fields. */
export type QuickCreateValues = { title: string; amount: string; form: FormData }

export type QuickCreateConfig<S extends string> = {
  titleLabel: string
  /** Extra inputs (named form fields) rendered under title and amount. */
  fields?: React.ReactNode
  onCreate: (stage: S, values: QuickCreateValues) => Promise<Result>
  /** The full form, prefilled from what was typed so far. */
  fullFormHref: (stage: S, values: QuickCreateValues) => string
}

function readQuickCreate(form: HTMLFormElement): QuickCreateValues {
  const data = new FormData(form)
  const text = (key: string) => String(data.get(key) ?? "").trim()
  return { title: text("title"), amount: text("amount"), form: data }
}

const OFFLINE = "Couldn't reach the server. Please try again."

export function KanbanBoard<S extends string>({
  label,
  columns,
  moveTargets = columns,
  cards,
  today,
  storageKey,
  emptyLabel,
  onMove,
  quickCreate,
}: {
  label: string
  columns: readonly KanbanColumn<S>[]
  /** Stages offered in each card's "Move to…" menu (defaults to the shown columns). */
  moveTargets?: readonly KanbanColumn<S>[]
  cards: readonly Card<S>[]
  /** YYYY-MM-DD in the org's timezone, for the due-state dots. */
  today: string
  /** localStorage key for fold state; include the user id. */
  storageKey: string
  emptyLabel: string
  onMove: (id: string, to: S) => Promise<Result>
  quickCreate?: QuickCreateConfig<S>
}) {
  // While a move is in flight the card shows in its new column; React drops this layer when the
  // transition ends, so a rejected move falls back to the unchanged server list.
  const [shown, applyMove] = useOptimistic(
    cards,
    (state: readonly Card<S>[], m: { id: string; to: S }) => moveCard(state, m.id, m.to)
  )
  const [, startTransition] = useTransition()
  const [folded, toggleFold] = useFoldedColumns(
    storageKey,
    columns.filter((c) => c.foldedByDefault).map((c) => c.id)
  )
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<S | null>(null)
  const [creatingIn, setCreatingIn] = useState<S | null>(null)
  // Moves, folds and closing quick create unmount the focused control; refocus its replacement.
  const refocus = useRef<string[]>([])
  useEffect(() => {
    const target = refocus.current
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find(Boolean)
    if (!target) return
    refocus.current = []
    target.focus()
  })

  function fold(id: S) {
    refocus.current = [folded.has(id) ? `[data-fold="${id}"]` : `[data-unfold="${id}"]`]
    toggleFold(id)
  }

  function move(id: string, to: S) {
    const card = shown.find((c) => c.id === id)
    if (!card || card.stage === to) return
    const target = moveTargets.find((c) => c.id === to)?.label ?? to
    startTransition(async () => {
      applyMove({ id, to })
      const res = await onMove(id, to).catch((): Result => ({ error: OFFLINE }))
      if (res.error) toast.error(res.error)
      else toast.success(`Moved "${card.title}" to ${target}`)
    })
  }

  function dropProps(column: S) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragging) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        if (over !== column) setOver(column)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const id = dragging ?? e.dataTransfer.getData("text/plain")
        setOver(null)
        setDragging(null)
        if (id) move(id, column)
      },
    }
  }

  const groups = groupCards(columns, shown)
  // A single (filtered) column is never folded away.
  const canFold = columns.length > 1

  return (
    <section aria-label={label} className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-4">
        {groups.map((group) =>
          canFold && folded.has(group.id) ? (
            <FoldedColumn
              key={group.id}
              group={group}
              highlighted={over === group.id}
              onUnfold={() => fold(group.id)}
              {...dropProps(group.id)}
            />
          ) : (
            <section
              key={group.id}
              aria-label={group.label}
              data-testid="kanban-column"
              className="w-72 shrink-0"
              {...dropProps(group.id)}
            >
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                <span className="text-muted-foreground text-xs">{group.cards.length}</span>
                <span className="text-muted-foreground ms-auto text-xs">
                  {formatTHBWhole(group.sumSatang)}
                </span>
                {quickCreate ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Quick create in ${group.label}`}
                    aria-expanded={creatingIn === group.id}
                    data-create={group.id}
                    onClick={() => setCreatingIn(creatingIn === group.id ? null : group.id)}
                  >
                    <Plus />
                  </Button>
                ) : null}
                {canFold ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Fold ${group.label}`}
                    data-fold={group.id}
                    onClick={() => fold(group.id)}
                  >
                    <ChevronsRightLeft />
                  </Button>
                ) : null}
              </div>
              <div
                className={cn(
                  "min-h-24 space-y-2 rounded-lg bg-muted/40 p-2 transition-colors",
                  over === group.id && "bg-muted ring-2 ring-ring/40"
                )}
              >
                {quickCreate && creatingIn === group.id ? (
                  <QuickCreate
                    stage={group.id}
                    config={quickCreate}
                    onClose={() => {
                      refocus.current = [`[data-create="${group.id}"]`]
                      setCreatingIn(null)
                    }}
                  />
                ) : null}
                {group.cards.length === 0 && creatingIn !== group.id ? (
                  <p className="text-muted-foreground px-2 py-6 text-center text-xs">{emptyLabel}</p>
                ) : null}
                {group.cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    columns={moveTargets}
                    today={today}
                    dragging={dragging === card.id}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => {
                      setDragging(null)
                      setOver(null)
                    }}
                    onMove={(to) => {
                      // Keyboard/touch path: follow the card, or its folded column.
                      refocus.current = [`[data-card="${card.id}"] [data-move]`, `[data-unfold="${to}"]`]
                      move(card.id, to)
                    }}
                  />
                ))}
              </div>
            </section>
          )
        )}
      </div>
    </section>
  )
}

function FoldedColumn<S extends string>({
  group,
  highlighted,
  onUnfold,
  ...drop
}: {
  group: KanbanGroup<S>
  highlighted: boolean
  onUnfold: () => void
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section aria-label={group.label} data-testid="kanban-column-folded" className="shrink-0" {...drop}>
      <button
        type="button"
        onClick={onUnfold}
        data-unfold={group.id}
        aria-label={`Unfold ${group.label} (${group.cards.length})`}
        className={cn(
          "text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-48 w-10 flex-col items-center gap-2 rounded-lg bg-muted/40 py-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          highlighted && "bg-muted ring-2 ring-ring/40"
        )}
      >
        <ChevronsLeftRight className="size-4" />
        <span className="font-medium [writing-mode:vertical-rl]">
          {group.label} ({group.cards.length})
        </span>
      </button>
    </section>
  )
}

function QuickCreate<S extends string>({
  stage,
  config,
  onClose,
}: {
  stage: S
  config: QuickCreateConfig<S>
  onClose: () => void
}) {
  const router = useRouter()
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      ref={formRef}
      className="space-y-2 rounded-lg border bg-card p-3 shadow-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const values = readQuickCreate(form)
        startTransition(async () => {
          const res = await config.onCreate(stage, values).catch((): Result => ({ error: OFFLINE }))
          if (res.error) {
            toast.error(res.error)
            return
          }
          toast.success(`Created "${values.title}"`)
          form.reset()
          form.querySelector<HTMLInputElement>("input[name=title]")?.focus()
        })
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${id}-title`}>{config.titleLabel}</Label>
        <Input id={`${id}-title`} name="title" required autoFocus autoComplete="off" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-amount`}>Amount (THB)</Label>
        <Input
          id={`${id}-amount`}
          name="amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder="0.00"
        />
      </div>
      {config.fields}
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (formRef.current) router.push(config.fullFormHref(stage, readQuickCreate(formRef.current)))
          }}
        >
          Edit
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Discard quick create"
          className="ms-auto"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
    </form>
  )
}
