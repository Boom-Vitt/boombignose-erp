type BrowserStore = Pick<Storage, "getItem" | "setItem">

/** Key recovery is a convenience; the DB validates every request and its roles. */
export function paymentCommandKey(store: BrowserStore, scope: string, details: readonly string[], createKey: () => string): string {
  const fingerprint = JSON.stringify(details)
  const name = `erp/payment-command/${scope}`
  try {
    const stored = JSON.parse(store.getItem(name) ?? "null")
    if (stored?.fingerprint === fingerprint && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.key)) return stored.key
  } catch { /* Missing or corrupt state must never grant authority. */ }
  const key = createKey()
  try { store.setItem(name, JSON.stringify({ fingerprint, key })) } catch { /* Caller retains command in memory. */ }
  return key
}

export function financialCommandKey(store: BrowserStore, scope: string, details: readonly string[], createKey: () => string): string {
  const key = paymentCommandKey(store, scope, details, createKey)
  if (JSON.parse(store.getItem(`erp/payment-command/${scope}`) ?? "null")?.key !== key) throw new Error("Browser storage is unavailable. Enable it before submitting financial commands.")
  return key
}

export function completePaymentCommand(store: BrowserStore, scope: string, key: string): void {
  const name = `erp/payment-command/${scope}`
  if (JSON.parse(store.getItem(name) ?? "null")?.key === key) store.setItem(name, "null")
}
