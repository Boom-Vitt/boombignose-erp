"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { serviceMoneyInput, serviceAmountSatang } from "@/lib/workflows/service"
import { Constants } from "@/lib/types/database"

const PROJECT_STATUS = Constants.public.Enums.project_status
const TASK_STATUS = Constants.public.Enums.task_status

/** Optional text field: trims; empty string becomes undefined. */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

/** A select that may be "none" (→ null) or a uuid. */
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? v : null))

/** "none" or "" → null, otherwise a user id (the demo seed's ids are not RFC UUIDs). */
const optionalOwner = z
  .union([z.literal("none"), z.literal(""), z.guid()])
  .optional()
  .transform((v) => (v && v !== "none" ? v : null))

const OWNER_ERROR = "Choose a team member as the owner."

async function isMember(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  orgId: string,
  userId: string
) {
  const { data, error } = await supabase.rpc("record_activity_assignees", { p_org_id: orgId })
  return !error && !!data?.some((m) => m.user_id === userId)
}

/** A date input value: "" → null, otherwise YYYY-MM-DD. */
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))

const ProjectInput = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  clientId: optionalId,
  status: z.enum(PROJECT_STATUS),
  deadline: optionalDate,
  budgetBaht: serviceMoneyInput.optional(),
  owner: optionalOwner,
  dealId: optionalId,
})

async function insertProject(
  ctx: Awaited<ReturnType<typeof requireOrgContext>>,
  p: z.output<typeof ProjectInput>
): Promise<{ id?: string; error?: string }> {
  const { name, clientId, status, deadline, budgetBaht, owner, dealId } = p

  const supabase = await createSupabaseClient()
  if (owner && !(await isMember(supabase, ctx.orgId, owner))) {
    return { error: OWNER_ERROR }
  }
  const { data, error } = await supabase
    .from("projects")
    .insert({
      org_id: ctx.orgId,
      name,
      client_id: clientId,
      status,
      deadline,
      budget_satang:
        budgetBaht !== undefined ? serviceAmountSatang(budgetBaht) : null,
      owner,
      deal_id: dealId,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/projects")
  return { id: data.id }
}

export async function createProject(
  input: z.input<typeof ProjectInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ProjectInput.safeParse(input)
  if (!parsed.success) {
    return { error: "Invalid input" }
  }

  const { id, error } = await insertProject(ctx, parsed.data)
  if (!id) return { error }
  redirect(`/projects/${id}`)
}

const QuickProjectInput = ProjectInput.pick({
  name: true,
  status: true,
  budgetBaht: true,
})

/** Board quick create: same insert as createProject, but stays on the board. */
export async function quickCreateProject(
  input: z.input<typeof QuickProjectInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = QuickProjectInput.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { error } = await insertProject(ctx, {
    ...parsed.data,
    clientId: null,
    deadline: null,
    owner: null,
    dealId: null,
  })
  return error ? { error } : {}
}

const UpdateProjectInput = ProjectInput.extend({
  id: z.string().min(1),
})

export async function updateProject(
  input: z.input<typeof UpdateProjectInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = UpdateProjectInput.safeParse(input)
  if (!parsed.success) {
    return { error: "Invalid input" }
  }
  const { id, name, clientId, status, deadline, budgetBaht, owner } =
    parsed.data

  const supabase = await createSupabaseClient()
  if (owner) {
    // A former member may stay as owner; only a change must name a current member.
    const { data: current } = await supabase
      .from("projects")
      .select("owner")
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .maybeSingle()
    if (current?.owner !== owner && !(await isMember(supabase, ctx.orgId, owner))) {
      return { error: OWNER_ERROR }
    }
  }
  const { error } = await supabase
    .from("projects")
    .update({
      name,
      client_id: clientId,
      status,
      deadline,
      budget_satang:
        budgetBaht !== undefined ? serviceAmountSatang(budgetBaht) : null,
      owner,
    })
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/projects")
  revalidatePath(`/projects/${id}`)
  redirect(`/projects/${id}`)
}

const UpdateStatusInput = z.object({
  id: z.string().min(1),
  status: z.enum(PROJECT_STATUS),
})

export async function updateProjectStatus(
  input: z.input<typeof UpdateStatusInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = UpdateStatusInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("projects")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/projects")
  revalidatePath(`/projects/${parsed.data.id}`)
  return {}
}

const AddTaskInput = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, "Task title is required"),
  status: z.enum(TASK_STATUS),
  dueDate: optionalDate,
  assignee: optionalText,
})

export async function addTask(
  input: z.input<typeof AddTaskInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = AddTaskInput.safeParse(input)
  if (!parsed.success) {
    return { error: "Invalid input" }
  }
  const { projectId, title, status, dueDate, assignee } = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from("project_tasks").insert({
    org_id: ctx.orgId,
    project_id: projectId,
    title,
    status,
    due_date: dueDate,
    assignee: assignee ?? null,
    done: status === "done",
  })

  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

const ToggleTaskInput = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  done: z.boolean(),
})

export async function toggleTask(
  input: z.input<typeof ToggleTaskInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ToggleTaskInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const { id, projectId, done } = parsed.data

  const supabase = await createSupabaseClient()
  // Keep status coherent with the done flag.
  const { error } = await supabase
    .from("project_tasks")
    .update({ done, status: done ? "done" : "todo" })
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

const AddMilestoneInput = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, "Milestone title is required"),
  dueDate: optionalDate,
})

export async function addMilestone(
  input: z.input<typeof AddMilestoneInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = AddMilestoneInput.safeParse(input)
  if (!parsed.success) {
    return { error: "Invalid input" }
  }
  const { projectId, title, dueDate } = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from("milestones").insert({
    org_id: ctx.orgId,
    project_id: projectId,
    title,
    due_date: dueDate,
  })

  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}

const ToggleMilestoneInput = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  done: z.boolean(),
})

export async function toggleMilestone(
  input: z.input<typeof ToggleMilestoneInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ToggleMilestoneInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const { id, projectId, done } = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("milestones")
    .update({ done })
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return {}
}
