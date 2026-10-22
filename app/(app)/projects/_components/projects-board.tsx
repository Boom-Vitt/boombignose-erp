"use client"

import type { KanbanCard, KanbanColumn } from "@/lib/kanban"
import type { Enums } from "@/lib/types/database"
import { KanbanBoard } from "@/components/kanban/kanban-board"
import { quickCreateProject, updateProjectStatus } from "../actions"

type ProjectStatus = Enums<"project_status">

export function ProjectsBoard({
  columns,
  moveTargets,
  cards,
  today,
  storageKey,
}: {
  columns: KanbanColumn<ProjectStatus>[]
  moveTargets?: KanbanColumn<ProjectStatus>[]
  cards: KanbanCard<ProjectStatus>[]
  today: string
  storageKey: string
}) {
  return (
    <KanbanBoard
      label="Projects board"
      columns={columns}
      moveTargets={moveTargets}
      cards={cards}
      today={today}
      storageKey={storageKey}
      emptyLabel="No projects"
      onMove={(id, status) => updateProjectStatus({ id, status })}
      quickCreate={{
        titleLabel: "Project name",
        onCreate: (status, { title, amount }) =>
          quickCreateProject({ status, name: title, budgetBaht: amount || undefined }),
        fullFormHref: (status, { title, amount }) =>
          `/projects/new?${new URLSearchParams({ status, name: title, budget: amount })}`,
      }}
    />
  )
}
