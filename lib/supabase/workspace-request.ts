export type WorkspaceProvisionRequest = { name: string; key: string }
type RequestStorage = Pick<Storage, "getItem" | "setItem">
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keep transport/reload retries tied to one actor and normalized request. */
export function workspaceProvisionRequest(
  actorId: string,
  name: string,
  storage?: RequestStorage,
  previous?: WorkspaceProvisionRequest | null,
): WorkspaceProvisionRequest {
  const normalized = name.trim()
  if (previous?.name === normalized) return previous
  const storageKey = `workspace-provision:${actorId}`
  try {
    const saved: unknown = JSON.parse(storage?.getItem(storageKey) ?? "null")
    if (saved && typeof saved === "object" && "name" in saved && "key" in saved &&
      saved.name === normalized && typeof saved.key === "string" && UUID.test(saved.key)) {
      return { name: normalized, key: saved.key }
    }
  } catch { /* Storage may be disabled or contain an interrupted write. */ }
  const request = { name: normalized, key: crypto.randomUUID() }
  try { storage?.setItem(storageKey, JSON.stringify(request)) } catch { /* In-memory retry still works. */ }
  return request
}
