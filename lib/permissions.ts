import type { Role } from "@/lib/auth"

/**
 * Capability-based RBAC. Instead of scattering `["owner","admin"]` role lists
 * across actions, each sensitive operation maps to a named Capability, and this
 * matrix is the single source of truth for which roles hold it. Tune access by
 * editing the matrix here — no need to touch call sites.
 *
 * RLS still enforces org isolation at the database; capabilities are the
 * defense-in-depth layer for *which member* may perform an action.
 */
export type Capability =
  | "settings:manage" // edit org settings (name, cash, burn)
  | "team:manage" // invite / revoke teammates
  | "accounting:manage" // connect/disconnect accounting, sync
  | "client:delete"
  | "deal:delete"
  | "template:manage" // create/edit/delete automation templates
  | "quote:convert" // convert a quote into an invoice
  | "quote:delete"
  | "invoice:delete"
  | "cost:delete"
  | "subscription:manage" // generate-now / delete a subscription
  | "audit:view" // view the audit log

const ALL_STAFF: Role[] = ["owner", "admin"]

/**
 * Which roles hold each capability. Today owner+admin share the operational
 * capabilities and members hold none of them; splitting a capability to
 * owner-only (e.g. billing-critical actions) is now a one-line change here.
 */
export const CAPABILITY_ROLES: Record<Capability, Role[]> = {
  "settings:manage": ALL_STAFF,
  "team:manage": ALL_STAFF,
  "accounting:manage": ALL_STAFF,
  "client:delete": ALL_STAFF,
  "deal:delete": ALL_STAFF,
  "template:manage": ALL_STAFF,
  "quote:convert": ALL_STAFF,
  "quote:delete": ALL_STAFF,
  "invoice:delete": ALL_STAFF,
  "cost:delete": ALL_STAFF,
  "subscription:manage": ALL_STAFF,
  "audit:view": ALL_STAFF,
}

/** True when `role` holds `capability`. */
export function can(role: Role, capability: Capability): boolean {
  return CAPABILITY_ROLES[capability].includes(role)
}

/** All capabilities a role holds (handy for shaping UI affordances). */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITY_ROLES) as Capability[]).filter((c) =>
    can(role, c)
  )
}
