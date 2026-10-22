"use client"

import { useId } from "react"

import type { KanbanCard, KanbanColumn } from "@/lib/kanban"
import type { Enums } from "@/lib/types/database"
import { KanbanBoard } from "@/components/kanban/kanban-board"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { quickCreateDeal, updateDealStage } from "../actions"

type Stage = Enums<"deal_stage">

export function DealsBoard({
  columns,
  moveTargets,
  cards,
  clients,
  today,
  storageKey,
}: {
  columns: KanbanColumn<Stage>[]
  moveTargets: KanbanColumn<Stage>[]
  cards: KanbanCard<Stage>[]
  clients: { id: string; name: string }[]
  today: string
  storageKey: string
}) {
  return (
    <KanbanBoard
      label="Deals board"
      columns={columns}
      moveTargets={moveTargets}
      cards={cards}
      today={today}
      storageKey={storageKey}
      emptyLabel="No deals"
      onMove={updateDealStage}
      quickCreate={{
        titleLabel: "Deal title",
        fields: <ClientField clients={clients} />,
        onCreate: (stage, { title, amount, form }) =>
          quickCreateDeal({
            stage,
            title,
            valueBaht: amount || 0,
            clientId: String(form.get("clientId") ?? ""),
          }),
        fullFormHref: (stage, { title, amount, form }) =>
          `/deals/new?${new URLSearchParams({
            stage,
            title,
            amount,
            clientId: String(form.get("clientId") ?? ""),
          })}`,
      }}
    />
  )
}

function ClientField({ clients }: { clients: { id: string; name: string }[] }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Client</Label>
      <Select
        name="clientId"
        items={clients.map((c) => ({ value: c.id, label: c.name }))}
      >
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue placeholder="Select a client" />
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
