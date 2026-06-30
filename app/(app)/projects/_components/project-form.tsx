"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Enums } from "@/lib/types/database"

type ProjectStatus = Enums<"project_status">

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "delivered", label: "Delivered" },
  { value: "support", label: "Support" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Cancelled" },
]

const STATUS_LABEL = Object.fromEntries(
  STATUS_OPTIONS.map((s) => [s.value, s.label])
) as Record<ProjectStatus, string>

const NONE = "none"

const FormSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  clientId: z.string(),
  status: z.enum([
    "not_started",
    "in_progress",
    "review",
    "delivered",
    "support",
    "paused",
    "cancelled",
  ]),
  deadline: z.string(),
  budgetBaht: z.coerce.number().min(0, "Budget cannot be negative"),
  owner: z.string(),
})

type FormInput = z.input<typeof FormSchema>
export type ProjectFormValues = z.output<typeof FormSchema>

export type ClientOption = { id: string; name: string }

export function ProjectForm({
  action,
  clients,
  defaultValues,
  submitLabel = "Create project",
}: {
  action: (values: ProjectFormValues) => Promise<{ error?: string }>
  clients: ClientOption[]
  defaultValues?: Partial<FormInput>
  submitLabel?: string
}) {
  const form = useForm<FormInput, unknown, ProjectFormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      clientId: NONE,
      status: "not_started",
      deadline: "",
      budgetBaht: 0,
      owner: "",
      ...defaultValues,
    },
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const res = await action(values)
          // On success the action redirects (throws), so we only reach here on error.
          if (res?.error) toast.error(res.error)
        })}
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Website automation" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="clientId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Client</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? NONE)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No client">
                        {(v: string | null) =>
                          !v || v === NONE
                            ? "No client"
                            : (clients.find((c) => c.id === v)?.name ?? "No client")
                        }
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>No client</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: ProjectStatus) => STATUS_LABEL[v]}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="deadline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deadline</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="budgetBaht"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Budget (THB)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={(field.value as number | string | undefined) ?? ""}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>Total project budget in baht.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="owner"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Owner</FormLabel>
              <FormControl>
                <Input placeholder="Who owns delivery?" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}
