"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"
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
  budgetBaht: z.coerce.number().min(0, "Budget cannot be negative").optional(),
  owner: optionalText,
  dealId: optionalId,
})

export async function createProject(
  input: z.input<typeof ProjectInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ProjectInput.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { name, clientId, status, deadline, budgetBaht, owner, dealId } =
    parsed.data

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("projects")
    .insert({
      org_id: ctx.orgId,
      name,
      client_id: clientId,
      status,
      deadline,
      budget_satang:
        budgetBaht !== undefined ? bahtToSatang(budgetBaht) : null,
      owner: owner ?? null,
      deal_id: dealId,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/projects")
  redirect(`/projects/${data.id}`)
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { id, name, clientId, status, deadline, budgetBaht, owner } =
    parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("projects")
    .update({
      name,
      client_id: clientId,
      status,
      deadline,
      budget_satang:
        budgetBaht !== undefined ? bahtToSatang(budgetBaht) : null,
      owner: owner ?? null,
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
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
