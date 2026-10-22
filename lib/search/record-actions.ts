import { z } from "zod"

import { recordHref } from "@/lib/record-history/model"
import { statusBar, type DocumentFlow, type FlowCommand } from "@/lib/record/status"

/** Records whose detail page shows a StatusBar. */
const STATUS_RECORDS = ["quote", "deal", "project", "invoice", "subscription"] as const

export type StatusRecordRef = { type: (typeof STATUS_RECORDS)[number]; id: string }

/** The record whose detail page `pathname` is, or null on any other page. */
export function recordFromPath(pathname: string): StatusRecordRef | null {
  for (const type of STATUS_RECORDS) {
    const prefix = recordHref(type, "")
    const id = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ""
    // guid, not uuid: seeded ids such as 90000000-0000-0000-0000-000000000001 carry no RFC version.
    if (z.guid().safeParse(id).success) return { type, id }
  }
  return null
}

export type PaletteAction =
  | { label: string; to: string }
  | { label: string; href: string }
  | { label: string; command: FlowCommand }

/**
 * The actions a record's StatusBar shows, under the same availability rule: a status
 * change needs a transition and a command needs a handler. A string handler is a link,
 * `true` means the palette runs the command itself.
 */
export function paletteActions<S extends string>(
  flow: DocumentFlow<S>,
  status: S,
  canTransition: boolean,
  commands: Partial<Record<FlowCommand, string | true>>
): PaletteAction[] {
  const bar = statusBar(flow, status, (a) => ("to" in a ? canTransition : !!commands[a.command]))
  return [...(bar.primary ? [bar.primary] : []), ...bar.secondary].map((action) => {
    if ("to" in action) return { label: action.label, to: action.to }
    const handler = commands[action.command]
    return typeof handler === "string"
      ? { label: action.label, href: handler }
      : { label: action.label, command: action.command }
  })
}
