"use server"

import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import {
  generateText,
  DEFAULT_MODEL,
  isAIConfigured,
  AINotConfiguredError,
} from "@/lib/ai/client"
import { dealSummaryPrompt, followupDraftPrompt, type Tone } from "@/lib/ai/prompts"

/**
 * Result of an AI assist. Discriminated union so callers branch cleanly:
 *  - `{ notConfigured: true }` → no API key; show a friendly notice, no crash.
 *  - `{ content }` → generated text (also cached to ai_outputs).
 *  - `{ error }` → a real failure worth toasting.
 */
export type AIResult =
  | { notConfigured: true }
  | { content: string }
  | { error: string }

const ToneInput = z.enum(["friendly", "formal", "brief"])

/** How many recent activities to feed the model as context. */
const ACTIVITY_LIMIT = 12

/** Load a deal (org-scoped), its client name, and recent activities. */
async function loadDealContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  dealId: string
) {
  const { data: deal } = await supabase
    .from("deals")
    .select("id, client_id, title, stage, value_satang")
    .eq("id", dealId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (!deal) return null

  const [{ data: client }, { data: activities }] = await Promise.all([
    supabase
      .from("clients")
      .select("name")
      .eq("id", deal.client_id)
      .eq("org_id", orgId)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("type, body, due_date, done")
      .eq("deal_id", dealId)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
  ])

  return {
    deal,
    clientName: client?.name ?? null,
    activities: activities ?? [],
  }
}

/** Persist a generated output so it can be reviewed later. Best-effort: a cache
 * write failure must not lose the content the user just generated. */
async function cacheOutput(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    orgId: string
    userId: string
    kind: "deal_summary" | "followup_draft"
    dealId: string
    content: string
  }
) {
  try {
    await supabase.from("ai_outputs").insert({
      org_id: args.orgId,
      entity: "deal",
      entity_id: args.dealId,
      kind: args.kind,
      model: DEFAULT_MODEL,
      content: args.content,
      created_by: args.userId,
    })
  } catch {
    // Best-effort: a cache-write failure must never lose the generated content.
  }
}

const DealId = z.string().uuid()

export async function summarizeDeal(dealId: string): Promise<AIResult> {
  const ctx = await requireOrgContext()
  // Explicit up-front guard — robust to dev module-boundary `instanceof` gaps.
  if (!isAIConfigured()) return { notConfigured: true }
  if (!DealId.safeParse(dealId).success) return { error: "Invalid deal." }

  const supabase = await createClient()
  const context = await loadDealContext(supabase, ctx.orgId, dealId)
  if (!context) return { error: "Deal not found." }

  const { deal, clientName, activities } = context
  const parts = dealSummaryPrompt({
    title: deal.title,
    stage: deal.stage,
    valueBaht: satangToBaht(deal.value_satang), // satang -> baht at the boundary
    client: clientName,
    activities,
  })

  try {
    const content = await generateText({ ...parts, maxTokens: 512 })
    await cacheOutput(supabase, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      kind: "deal_summary",
      dealId,
      content,
    })
    return { content }
  } catch (e) {
    if (e instanceof AINotConfiguredError) return { notConfigured: true }
    return { error: "Could not generate a summary. Please try again." }
  }
}

export async function draftFollowup(
  dealId: string,
  tone?: string
): Promise<AIResult> {
  const ctx = await requireOrgContext()
  if (!isAIConfigured()) return { notConfigured: true }
  if (!DealId.safeParse(dealId).success) return { error: "Invalid deal." }

  const parsedTone = ToneInput.safeParse(tone)
  const toneValue: Tone | undefined = parsedTone.success ? parsedTone.data : undefined

  const supabase = await createClient()
  const context = await loadDealContext(supabase, ctx.orgId, dealId)
  if (!context) return { error: "Deal not found." }

  const { deal, clientName, activities } = context
  const parts = followupDraftPrompt({
    title: deal.title,
    client: clientName,
    activities,
    tone: toneValue,
  })

  try {
    const content = await generateText({ ...parts, maxTokens: 512 })
    await cacheOutput(supabase, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      kind: "followup_draft",
      dealId,
      content,
    })
    return { content }
  } catch (e) {
    if (e instanceof AINotConfiguredError) return { notConfigured: true }
    return { error: "Could not draft a follow-up. Please try again." }
  }
}
