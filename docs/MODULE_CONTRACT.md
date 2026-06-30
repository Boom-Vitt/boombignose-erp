# Module Contract — read before building any module

This is the shared contract every module follows so six modules can be built in
parallel without conflicts and with a consistent look & feel.

## 1. File layout (stay in your lane)

Each module owns exactly one route-group folder under `app/(app)/<module>/` and
one server-actions file. Put module-only components in a local `_components/`
folder inside your module. Example for CRM:

```
app/(app)/clients/
  page.tsx                 # list (server component)
  new/page.tsx             # create form route
  [id]/page.tsx            # detail (server component)
  actions.ts               # "use server" mutations for this module
  _components/             # client components used only by this module
    client-form.tsx
    clients-table.tsx
```

**Do NOT touch** (owned by the foundation / other lanes):
`package.json`, `pnpm-lock.yaml`, `lib/**`, `components/ui/**`, `components/nav.ts`,
`components/app-sidebar.tsx`, `app/layout.tsx`, `app/(app)/layout.tsx`,
`middleware.ts`, `supabase/**`, or any other module's folder.
**Do NOT** run `pnpm install`, `pnpm dlx shadcn ...`, `pnpm build`, or `pnpm dev`.
All dependencies and UI components are already installed. The orchestrator runs
the integrated build/typecheck — you just write correct code per this contract.

## 2. Data, auth, and org scoping

```ts
import { createClient } from "@/lib/supabase/server"   // server components/actions
import { requireOrgContext } from "@/lib/auth"          // { userId, email, orgId, orgName, role }
```

- Reads happen in **server components**; mutations in **server actions** (`"use server"`).
- RLS already scopes every query to the caller's org. Still set `org_id: ctx.orgId`
  on every insert (defense in depth). Never trust a client-supplied org id.
- Role: `ctx.role` is `"owner" | "admin" | "member"`. Use `requireRole(ctx, ["owner","admin"])`
  for destructive/financial actions where appropriate (members can do normal CRUD).

## 3. Types

```ts
import type { Tables, TablesInsert, Enums } from "@/lib/types/database"
type Client = Tables<"clients">
type DealStage = Enums<"deal_stage">
```

## 4. Money = integer satang (NEVER floats)

```ts
import { formatTHB, formatTHBWhole, bahtToSatang, satangToBaht } from "@/lib/money"
```

Forms collect **baht** from the user → convert with `bahtToSatang()` before insert.
Display stored `*_satang` with `formatTHB()` / `formatTHBWhole()`. Never hand-roll
the ×100. Use `z.coerce.number()` for the baht field, then convert in the action.

## 5. UI primitives — this is **Base UI**, not Radix

shadcn components live in `@/components/ui/*`. For polymorphism (rendering a
component as a `next/link`), use the **`render` prop**, NOT `asChild`:

```tsx
import Link from "next/link"
import { Button } from "@/components/ui/button"

// ✅ correct (Base UI)
<Button render={<Link href="/clients/new" />}>New client</Button>
// ❌ wrong — `asChild` does not exist here
```

Available primitives include: button, card, input, label, textarea, select,
checkbox, switch, radio-group, badge, table, tabs, dialog, alert-dialog, sheet,
dropdown-menu, form, sonner, separator, avatar, skeleton, popover, calendar,
command, alert, tooltip, scroll-area, breadcrumb, progress.

Shared building blocks (reuse these):

```ts
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { DealStageBadge, ProjectStatusBadge, InvoiceStatusBadge, TaskStatusBadge } from "@/components/status-badge"
import { toast } from "sonner"
```

## 6. Forms (react-hook-form + Zod v4 + `@/components/ui/form`)

We use **Zod v4**: `z.object`, `z.string().min(1)`, `z.coerce.number()`,
`z.enum([...])`, `z.email()`. Use the Form wrapper:

```tsx
"use client"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const Schema = z.object({ name: z.string().min(1, "Required"), valueBaht: z.coerce.number().min(0) })
type Values = z.infer<typeof Schema>

export function ClientForm({ action }: { action: (v: Values) => Promise<{ error?: string }> }) {
  const form = useForm<Values>({ resolver: zodResolver(Schema), defaultValues: { name: "", valueBaht: 0 } })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(async (v) => {
        const res = await action(v)
        if (res?.error) return toast.error(res.error)
        toast.success("Saved")
      })} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
      </form>
    </Form>
  )
}
```

`FormControl` wraps a **single** child input (it injects id/aria via cloneElement).

## 7. Server actions

```ts
"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"

const CreateClient = z.object({ name: z.string().min(1), industry: z.string().optional() })

export async function createClient_(input: z.infer<typeof CreateClient>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = CreateClient.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const supabase = await createClient()
  const { error } = await supabase.from("clients").insert({ ...parsed.data, org_id: ctx.orgId })
  if (error) return { error: error.message }
  revalidatePath("/clients")
  return {}
}
```

- Return `{ error?: string }` (empty object = success). The client toasts on error.
- For create flows that should land on a detail page, `redirect("/clients/" + id)`
  AFTER a successful insert (use `.select("id").single()` to get the id).
- Always `revalidatePath` the affected list/detail route(s).
- Name your exported action functions clearly (avoid clashing with `createClient`
  from the supabase import — alias the import or name actions like `createClientAction`).

## 8. Look & feel

- Every page starts with `<PageHeader title=... description=... >` (actions on the right).
- Lists: a shadcn `Table` or cards; show an `EmptyState` when empty.
- Use the status badges for stages/statuses. Mobile-friendly (stack on small screens).
- Keep it clean and founder-friendly — no dense enterprise ERP clutter.

## 9. Demo data already exists

The seed created an org with clients, contacts, deals, activities, projects,
tasks, milestones, invoices, payments, costs, template categories, and templates.
Build against those tables; your pages should show real seeded rows immediately.
