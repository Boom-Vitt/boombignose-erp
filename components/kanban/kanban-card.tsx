"use client"

import Link from "next/link"
import { ArrowRightLeft } from "lucide-react"

import { dueState, initials, type DueState, type KanbanCard as Card, type KanbanColumn } from "@/lib/kanban"
import { formatTHB } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const DUE: Record<DueState, { label: string; className: string }> = {
  overdue: { label: "overdue", className: "bg-red-500" },
  today: { label: "due today", className: "bg-amber-500" },
  planned: { label: "planned", className: "bg-emerald-500" },
}

export function KanbanCard<S extends string>({
  card,
  columns,
  today,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: Card<S>
  columns: readonly KanbanColumn<S>[]
  today: string
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (to: S) => void
}) {
  const due = card.due ? DUE[dueState(card.due, today)] : null

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id)
        e.dataTransfer.effectAllowed = "move"
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      data-testid="kanban-card"
      className={cn(
        "group/card relative cursor-grab rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-colors hover:border-ring active:cursor-grabbing",
        dragging && "opacity-50"
      )}
    >
      <Link
        href={card.href}
        draggable={false}
        className="block pr-7 text-sm font-medium leading-snug outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        {card.title}
      </Link>
      {card.amountSatang !== null ? (
        <div className="mt-1 text-sm font-semibold">{formatTHB(card.amountSatang)}</div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-muted-foreground truncate text-xs">{card.client ?? "—"}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {due ? (
            <span
              className={cn("size-2 rounded-full", due.className)}
              title={`Next activity ${due.label} (${card.due})`}
            >
              <span className="sr-only">
                Next activity {due.label} ({card.due})
              </span>
            </span>
          ) : null}
          {card.owner ? (
            <span
              className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-[0.65rem] font-semibold"
              title={card.owner}
            >
              <span aria-hidden>{initials(card.owner)}</span>
              <span className="sr-only">Owner: {card.owner}</span>
            </span>
          ) : null}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move "${card.title}" to…`}
              className="absolute top-2 right-2 z-10"
            />
          }
        >
          <ArrowRightLeft />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to…</DropdownMenuLabel>
            {columns
              .filter((c) => c.id !== card.stage)
              .map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => onMove(c.id)}>
                  {c.label}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
