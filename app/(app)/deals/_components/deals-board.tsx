"use client"

import { useId, useState } from "react"

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
import { LostReasonDialog, type LostReason } from "./lost-reason-dialog"

type Stage = Enums<"deal_stage">
type Result = { error?: string; cancelled?: boolean }
/** A drop on Lost waits here until the dialog picks a reason or is closed. */
type PendingLoss = { id: string; title: string; after: string | null; settle: (result: Result) => void }

export function DealsBoard({
  columns,
  moveTargets,
  cards,
  clients,
  today,
  storageKey,
  lostReasons,
  canManageReasons,
}: {
  columns: KanbanColumn<Stage>[]
  moveTargets: KanbanColumn<Stage>[]
  cards: KanbanCard<Stage>[]
  clients: { id: string; name: string }[]
  today: string
  storageKey: string
  lostReasons: LostReason[]
  canManageReasons: boolean
}) {
  const [losing, setLosing] = useState<PendingLoss | null>(null)

  return (
    <>
      <KanbanBoard
        label="Deals board"
        columns={columns}
        moveTargets={moveTargets}
        cards={cards}
        today={today}
        storageKey={storageKey}
        emptyLabel="No deals"
        reorderable
        onMove={(id, to, after) =>
          to === "lost"
            ? new Promise<Result>((settle) =>
                setLosing({ id, title: cards.find((c) => c.id === id)?.title ?? "", after, settle })
              )
            : updateDealStage(id, to, { after })
        }
        quickCreate={{
          titleLabel: "Deal title",
          canCreateIn: (stage) => stage !== "lost",
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
      {losing ? (
        <LostReasonDialog
          key={losing.id}
          open
          onOpenChange={(open) => {
            if (open) return
            losing.settle({ cancelled: true })
            setLosing(null)
          }}
          dealTitle={losing.title}
          reasons={lostReasons}
          canManage={canManageReasons}
          onConfirm={async (lostReasonId) => {
            const res = await updateDealStage(losing.id, "lost", { after: losing.after, lostReasonId })
            if (!res.error) {
              losing.settle({})
              setLosing(null)
            }
            return res
          }}
        />
      ) : null}
    </>
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
