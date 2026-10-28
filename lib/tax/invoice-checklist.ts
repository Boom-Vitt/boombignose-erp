import { z } from "zod"

/** Optional profile fields. Saving them does not make a document a statutory tax invoice. */
export const TaxInvoiceTemplate = z.object({
  seller_phone: z.string().trim().max(40).default(""),
  branch_code: z.string().trim().regex(/^$|^\d{5}$/).default(""),
  copy_label: z.string().trim().max(40).default(""),
})

export type TaxInvoiceTemplateInput = z.infer<typeof TaxInvoiceTemplate>

export function readTaxInvoiceTemplate(value: unknown): TaxInvoiceTemplateInput {
  const parsed = TaxInvoiceTemplate.safeParse(value ?? {})
  return parsed.success ? parsed.data : { seller_phone: "", branch_code: "", copy_label: "" }
}

export type TaxInvoiceCheck = {
  id: string
  label: string
  state: "present" | "missing" | "per_document" | "gap"
  detail: string
}

const STATE_NOTE = "Saving this does not make the document a statutory tax invoice, and it is not copied into the issued snapshot."

export function taxInvoiceChecklist(input: {
  legalName: string
  address: string
  taxId: string
  branchLabel: string
  taxStatus: "unknown" | "not_registered" | "registered"
  template: TaxInvoiceTemplateInput
}): TaxInvoiceCheck[] {
  const filled = (value: string) => value.trim().length > 0
  const taxId = /^[0-9]{13}$/.test(input.taxId.trim())
  const seller: TaxInvoiceCheck[] = [
    { id: "seller-name", label: "Seller name", state: filled(input.legalName) ? "present" : "missing", detail: "Statutory tax invoices name the seller." },
    { id: "seller-address", label: "Seller address", state: filled(input.address) ? "present" : "missing", detail: "Statutory tax invoices show the seller address." },
    { id: "seller-tax-id", label: "Seller tax ID", state: taxId ? "present" : "missing", detail: taxId ? "13 digits are stored on the profile." : "A 13-digit tax ID is blank or incomplete here." },
    { id: "seller-branch", label: "Seller branch", state: filled(input.branchLabel) ? "present" : "missing", detail: "Branch text such as สำนักงานใหญ่. A blank branch is not a five-digit branch code." },
  ]
  const optional: TaxInvoiceCheck[] = [
    { id: "seller-phone", label: "Seller phone", state: filled(input.template.seller_phone) ? "present" : "missing", detail: `Optional. ${STATE_NOTE}` },
    { id: "branch-code", label: "Branch code", state: /^\d{5}$/.test(input.template.branch_code) ? "present" : "missing", detail: `Optional five digits. ${STATE_NOTE}` },
    { id: "copy-label", label: "Original or copy label", state: filled(input.template.copy_label) ? "present" : "missing", detail: `Optional words such as ต้นฉบับ or สำเนา. A label is not a legal original/copy control. ${STATE_NOTE}` },
  ]
  const perDocument: TaxInvoiceCheck[] = [
    ["buyer-name", "Buyer name"],
    ["buyer-address", "Buyer address"],
    ["buyer-tax-id", "Buyer tax ID"],
    ["number", "Document number"],
    ["date", "Issue date"],
    ["lines", "Lines with quantity and price"],
    ["currency", "THB amounts"],
  ].map(([id, label]) => ({ id, label, state: "per_document" as const, detail: "Taken from each issued invoice snapshot. This page does not inspect one invoice." }))
  perDocument.push({
    id: "vat",
    label: "VAT",
    state: "per_document",
    detail: input.taxStatus === "registered"
      ? "Registered profiles calculate VAT on the document. That calculation is not an e-Tax Invoice."
      : "VAT is calculated only when the profile is registered. An unregistered profile does not produce a tax invoice.",
  })
  const gaps: TaxInvoiceCheck[] = [
    { id: "statutory-name", label: "Calling the document a statutory ใบกำกับภาษี", state: "gap", detail: "Issued documents stay operational invoices." },
    { id: "etax", label: "e-Tax Invoice submission", state: "gap", detail: "Nothing is sent to the Revenue Department." },
    { id: "series", label: "Separate tax-invoice number series", state: "gap", detail: "Numbers stay on the operational INV series." },
    { id: "signature", label: "Authorized signature as a legal control", state: "gap", detail: "No signature is captured or checked." },
    { id: "cash-credit", label: "Cash or credit classification", state: "gap", detail: "The document does not classify the sale as cash or credit." },
    { id: "original-copy", label: "Original or copy as a legal control", state: "gap", detail: "An optional label does not control which copy is the original." },
  ]
  if (input.taxStatus !== "registered") gaps.unshift({ id: "registration", label: "VAT registration", state: "gap", detail: "The profile is not registered for VAT, so these documents are not tax invoices." })
  return [...seller, ...optional, ...perDocument, ...gaps]
}
