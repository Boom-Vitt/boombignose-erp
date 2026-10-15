"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability, requireRole } from "@/lib/auth"
import { formatTHBWhole } from "@/lib/money"
import { writeAudit } from "@/lib/audit"
import { todayISO } from "@/lib/dates"
import { paymentAmount, moneyInput } from "@/lib/payments/input"
import { nextDocumentNumber } from "@/lib/documents/numbering"

const INVOICE_STATUSES = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
] as const

const RECURRING_INTERVALS = ["weekly", "monthly", "quarterly", "yearly"] as const

const COST_CATEGORIES = [
  "software",
  "contractor",
  "infra",
  "marketing",
  "salary",
  "other",
] as const

/** Empty string from an optional <input> → undefined (so zod .optional() applies). */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

/** Optional id select: "" (none) → null. */
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))

/** Optional date (YYYY-MM-DD) from a date input: "" → null. */
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const CreateInvoice = z.object({
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  number: optionalString,
  status: z.enum(INVOICE_STATUSES).default("draft"),
  issue_date: optionalDate,
  due_date: optionalDate,
  amountBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter a nonnegative THB amount with up to two decimals"),
  is_recurring: z.coerce.boolean().default(false),
  recurring_interval: z.enum(RECURRING_INTERVALS).nullish(),
  notes: optionalString,
})

export async function createInvoice(
  input: z.input<typeof CreateInvoice>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireRole(ctx, ["owner", "admin"]) }
  catch { return { error: "Only owners and admins can manage invoices." } }
  const parsed = CreateInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data
  if (d.due_date && d.due_date < (d.issue_date ?? todayISO())) return { error: "Due date cannot be before the issue date" }

  const supabase = await createSupabaseClient()

  // Auto-generate the invoice number when none was provided. Scans the org's
  // existing numbers for the current year and continues the running counter.
  // Manual numbers are used verbatim; a rare unique(org_id, number) collision
  // surfaces as the DB error below, exactly as before.
  let number = d.number
  if (!number) {
    const year = Number(todayISO().slice(0, 4))
    const { data: existing } = await supabase
      .from("invoices")
      .select("number")
      .eq("org_id", ctx.orgId)
    number = nextDocumentNumber(
      "INV",
      (existing ?? []).map((r) => r.number),
      year
    )
  }

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      org_id: ctx.orgId,
      client_id: d.client_id,
      project_id: d.project_id,
      number,
      status: d.status,
      // Column defaults use the database's UTC day; before 07:00 Bangkok that is yesterday.
      issue_date: d.issue_date ?? todayISO(),
      due_date: d.due_date,
      amount_satang: moneyInput(d.amountBaht),
      is_recurring: d.is_recurring,
      recurring_interval: d.is_recurring ? (d.recurring_interval ?? null) : null,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: data.id,
    action: "created",
    summary: `Created invoice ${number} for ${formatTHBWhole(moneyInput(d.amountBaht))}`,
  })

  revalidatePath("/finance")
  redirect(`/finance/invoices/${data.id}`)
}

const UpdateInvoice = z.object({
  id: z.string().min(1),
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  // The shared form marks number optional (create auto-numbers). On edit the
  // field is prefilled, so a blank number simply leaves the stored one untouched.
  number: optionalString,
  status: z.enum(INVOICE_STATUSES),
  issue_date: optionalDate,
  due_date: optionalDate,
  amountBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter a nonnegative THB amount with up to two decimals"),
  is_recurring: z.coerce.boolean(),
  recurring_interval: z.enum(RECURRING_INTERVALS).nullish(),
  notes: optionalString,
})

export async function updateInvoice(
  input: z.input<typeof UpdateInvoice>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireRole(ctx, ["owner", "admin"]) }
  catch { return { error: "Only owners and admins can manage invoices." } }
  const parsed = UpdateInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data
  if (d.due_date && d.issue_date && d.due_date < d.issue_date) return { error: "Due date cannot be before the issue date" }

  const supabase = await createSupabaseClient()
  // A blank issue date keeps the stored one, so that is the date the due date must follow.
  if (d.due_date && !d.issue_date) {
    const { data: current, error: readError } = await supabase
      .from("invoices")
      .select("issue_date")
      .eq("id", d.id)
      .eq("org_id", ctx.orgId)
      .maybeSingle()
    if (readError) return { error: "Unable to check the issue date. Please try again." }
    if (current && d.due_date < current.issue_date) return { error: "Due date cannot be before the issue date" }
  }

  const { error } = await supabase
    .from("invoices")
    .update({
      client_id: d.client_id,
      project_id: d.project_id,
      ...(d.number ? { number: d.number } : {}),
      status: d.status,
      issue_date: d.issue_date ?? undefined,
      due_date: d.due_date,
      amount_satang: moneyInput(d.amountBaht),
      is_recurring: d.is_recurring,
      recurring_interval: d.is_recurring ? (d.recurring_interval ?? null) : null,
      notes: d.notes ?? null,
    })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Payments (with invoice status recompute)
// ---------------------------------------------------------------------------

const StaffClaim = z.object({
  invoiceId: z.guid(), key: z.uuid(), amountBaht: z.string(),
  reference: z.string().trim().min(3).max(500),
})

/** Compatibility name: reporting a payment creates a pending claim, never cash. */
export async function recordPayment(input: z.input<typeof StaffClaim>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can report staff payment claims." } }
  const parsed = StaffClaim.safeParse(input)
  if (!parsed.success) return { error: "Invalid payment report" }
  const d = parsed.data
  let amount: number
  try { amount = paymentAmount(d.amountBaht) }
  catch { return { error: "Enter a valid positive THB amount with up to two decimals" } }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("submit_internal_payment_claim", {
    p_org_id: ctx.orgId, p_invoice_id: d.invoiceId, p_amount_satang: amount,
    p_reference: d.reference, p_key: d.key,
  })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

const EvidenceFields = {
  paidOn: z.iso.date().refine(value => value <= todayISO(), "Bank date cannot be in the future").optional(),
  method: z.enum(["transfer", "cash", "card", "promptpay", "cheque", "other"]).optional(),
}
const ReconcileLegacy = StaffClaim.extend({ legacyPaymentId: z.guid(), ...EvidenceFields }).refine(value => !!value.paidOn === !!value.method, "Provide bank date and payment method together")

export async function reconcileLegacyPayment(input: z.input<typeof ReconcileLegacy>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can reconcile legacy receipts." } }
  const parsed = ReconcileLegacy.safeParse(input)
  if (!parsed.success) return { error: "Invalid reconciliation details" }
  const d = parsed.data
  let amount: number
  try { amount = paymentAmount(d.amountBaht) }
  catch { return { error: "Enter a valid positive THB amount with up to two decimals" } }
  const supabase = await createSupabaseClient()
  const args = { p_org_id: ctx.orgId, p_legacy_payment_id: d.legacyPaymentId, p_amount_satang: amount, p_reference: d.reference, p_key: d.key }
  const { error } = d.paidOn && d.method
    ? await supabase.rpc("reconcile_legacy_payment_with_evidence", { ...args, p_paid_on: d.paidOn, p_method: d.method })
    : await supabase.rpc("reconcile_legacy_payment", args)
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

const ReviewClaim = z.object({
  claimId: z.guid(), invoiceId: z.guid(), key: z.uuid(),
  amountBaht: z.string(), reference: z.string().trim().min(3).max(500),
  decision: z.enum(["verified", "rejected"]), ...EvidenceFields,
}).refine(value => !!value.paidOn === !!value.method, "Provide bank date and payment method together")

export async function reviewPaymentClaim(input: z.input<typeof ReviewClaim>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can verify receipts." } }
  const parsed = ReviewClaim.safeParse(input)
  if (!parsed.success) return { error: "Invalid verification details" }
  const d = parsed.data
  let amount = 0
  try { if (d.decision === "verified") amount = paymentAmount(d.amountBaht) }
  catch { return { error: "Enter a valid positive THB amount" } }
  const supabase = await createSupabaseClient()
  // invoiceId is only used for revalidation; the DB resolves the actual claim's invoice.
  const args = { p_org_id: ctx.orgId, p_claim_id: d.claimId, p_key: d.key, p_amount_satang: amount, p_reference: d.reference, p_decision: d.decision }
  const { error } = d.paidOn && d.method
    ? await supabase.rpc("review_payment_claim_with_evidence", { ...args, p_paid_on: d.paidOn, p_method: d.method })
    : await supabase.rpc("review_payment_claim", args)
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

const CreateCost = z.object({
  category: z.enum(COST_CATEGORIES).default("other"),
  amountBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter a nonnegative THB amount with up to two decimals"),
  incurred_on: optionalDate,
  vendor: optionalString,
  project_id: optionalId,
  notes: optionalString,
})

export async function createCost(
  input: z.input<typeof CreateCost>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = CreateCost.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data: cost, error } = await supabase
    .from("costs")
    .insert({
      org_id: ctx.orgId,
      category: d.category,
      amount_satang: moneyInput(d.amountBaht),
      // Column defaults use the database's UTC day; before 07:00 Bangkok that is yesterday.
      incurred_on: d.incurred_on ?? todayISO(),
      vendor: d.vendor,
      project_id: d.project_id,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "cost",
    entityId: cost.id,
    action: "created",
    summary: `Recorded ${formatTHBWhole(moneyInput(d.amountBaht))} ${d.category} cost`,
    meta: { category: d.category, vendor: d.vendor ?? null },
  })

  revalidatePath("/finance")
  redirect("/finance")
}

const DeleteCost = z.object({ id: z.string().min(1) })

export async function deleteCost(
  input: z.input<typeof DeleteCost>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "cost:delete")
  } catch {
    return { error: "Only owners and admins can delete costs." }
  }
  const parsed = DeleteCost.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("costs")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/finance")
  return {}
}

const IssueInvoice = z.object({ invoiceId: z.guid(), expectedVersion: z.number().int().min(1).max(2147483647), key: z.uuid() })
export async function issueInvoice(input: z.input<typeof IssueInvoice>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireRole(ctx, ["owner", "admin"]) }
  catch { return { error: "Only owners and admins can issue invoices." } }
  const parsed = IssueInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid issue request" }
  const d = parsed.data
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("issue_invoice", { p_org_id: ctx.orgId, p_invoice_id: d.invoiceId, p_expected_version: d.expectedVersion, p_key: d.key })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

const BusinessProfile = z.object({
  expectedOrgId: z.guid(),
  legalName: z.string().trim().min(1).max(200), address: z.string().trim().min(1).max(1000),
  taxId: z.string().trim().refine(value => value === "" || /^[0-9]{13}$/.test(value), "Enter a 13-digit tax ID or leave it blank"), taxStatus: z.enum(["unknown", "not_registered", "registered"]),
}).refine(value => value.taxStatus !== "registered" || value.taxId.length === 13, "Registered VAT profile needs a tax ID")
export async function updateBusinessProfile(input: z.input<typeof BusinessProfile>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireRole(ctx, ["owner", "admin"]) }
  catch { return { error: "Only owners and admins can update the business profile." } }
  const parsed = BusinessProfile.safeParse(input)
  if (!parsed.success) return { error: "Enter the legal business name, address and explicit tax status." }
  const d = parsed.data
  if (d.expectedOrgId !== ctx.orgId) return { error: "Workspace changed. Reload this form before saving the business profile." }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("update_business_profile", {
    p_org_id: ctx.orgId, p_legal_name: d.legalName, p_business_address: d.address,
    p_tax_id: d.taxId, p_tax_status: d.taxStatus,
  })
  if (error) return { error: error.message }
  revalidatePath("/finance/business-profile")
  return {}
}
