/**
 * Provider-neutral accounting integration seam.
 *
 * SCOPE: This is a SYNC SCAFFOLD to an external book-of-record (FlowAccount /
 * PEAK / Xero) — NOT an accounting or tax engine. We do not generate tax
 * invoices or compute VAT here. We map our internal invoice to a
 * provider-neutral payload and hand it to a provider adapter.
 *
 * The `pushInvoice` implementations below are deliberate STUBS: they return a
 * deterministic fake external id and perform NO network I/O (there are no
 * credentials in this MVP). The interface is the clean seam a real provider
 * client (HTTP + OAuth) drops into later — see the marked spot in each stub.
 */

/**
 * Neutral representation of one of our invoices, ready to hand to any provider.
 * Providers expect money in whole baht (a decimal), so `totalBaht` is baht —
 * convert from our integer satang via `satangToBaht` when building this.
 */
export type ExternalInvoicePayload = {
  reference: string
  customerName: string
  issueDate: string | null
  dueDate: string | null
  currency: string
  totalBaht: number
  status: string
}

/** The three providers we scaffold against. Matches the `accounting_provider` enum. */
export type ProviderKey = "flowaccount" | "peak" | "xero"

export interface AccountingProvider {
  key: ProviderKey
  label: string
  /**
   * Push (create/upsert) an invoice in the external system, returning its id
   * there. STUB in this MVP — see implementations in PROVIDERS.
   */
  pushInvoice(payload: ExternalInvoicePayload): Promise<{ externalId: string }>
}

/**
 * Build a stub provider. The `pushInvoice` returns a deterministic fake id and
 * makes NO real request.
 *
 * ⇩⇩⇩ REAL CLIENT PLUGS IN HERE ⇩⇩⇩
 * A production adapter would, inside `pushInvoice`:
 *   1. read stored OAuth/API credentials (from `accounting_connections.config`),
 *   2. map `payload` to the provider's invoice DTO,
 *   3. POST to the provider's create-invoice endpoint,
 *   4. return the provider's document id as `externalId`.
 * Everything else in this codebase (mapping, the sync action, the sync map)
 * stays unchanged — only this function body becomes a real HTTP call.
 */
function stubProvider(key: ProviderKey, label: string): AccountingProvider {
  return {
    key,
    label,
    async pushInvoice(payload) {
      // STUB: deterministic fake id, no network call.
      return { externalId: `${key.toUpperCase()}-${payload.reference}` }
    },
  }
}

/** Registry of all supported providers, keyed by provider enum value. */
export const PROVIDERS: Record<ProviderKey, AccountingProvider> = {
  flowaccount: stubProvider("flowaccount", "FlowAccount"),
  peak: stubProvider("peak", "PEAK"),
  xero: stubProvider("xero", "Xero"),
}

/** All providers as a list (for building a picker in the UI). */
export const PROVIDER_LIST: AccountingProvider[] = Object.values(PROVIDERS)

/** Look up a provider adapter by key. */
export function getProvider(key: ProviderKey): AccountingProvider {
  return PROVIDERS[key]
}
