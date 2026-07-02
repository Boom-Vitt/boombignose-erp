"use server"

import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import {
  generateText,
  DEFAULT_MODEL,
  isAIConfigured,
  AINotConfiguredError,
} from "@/lib/ai/client"
import { meetingIntakePrompt } from "@/lib/ai/prompts"
import { parseActionItems, type ActionItem } from "@/lib/ai/parse"

/**
 * Result of a meeting intake. Discriminated union mirroring the deal AI actions:
 *  - `{ notConfigured: true }` → no API key; page shows a friendly notice.
 *  - `{ content, items }` → summary text plus parsed action items.
 *  - `{ error }` → a real failure worth surfacing.
 */
export type IntakeResult =
  | { notConfigured: true }
  | { content: string; items: ActionItem[] }
  | { error: string }

const NotesInput = z.string().trim().min(1, "Paste some meeting notes first.")

export async function intakeMeeting(notes: string): Promise<IntakeResult> {
  const ctx = await requireOrgContext()
  if (!isAIConfigured()) return { notConfigured: true }

  const parsed = NotesInput.safeParse(notes)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid notes." }
  }

  const parts = meetingIntakePrompt(parsed.data)

  try {
    const content = await generateText({ ...parts, maxTokens: 800 })
    const items = parseActionItems(content)

    // Best-effort cache — a write failure must not lose the generated result,
    // so its own try/catch keeps a throwing insert from discarding `content`.
    try {
      const supabase = await createClient()
      await supabase.from("ai_outputs").insert({
        org_id: ctx.orgId,
        entity: "meeting",
        entity_id: null,
        kind: "meeting_intake",
        model: DEFAULT_MODEL,
        content,
        created_by: ctx.userId,
      })
    } catch {
      // ignore — the generated content is still returned below
    }

    return { content, items }
  } catch (e) {
    if (e instanceof AINotConfiguredError) return { notConfigured: true }
    return { error: "Could not process the notes. Please try again." }
  }
}
