"use client"

import { useRouter } from "next/navigation"
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
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

import { SelectField, type Option } from "./form-fields"

const INTERVAL_OPTIONS: Option[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
]

const Schema = z.object({
  name: z.string().min(1, "Name is required"),
  client_id: z.string().min(1, "Choose a client"),
  project_id: z.string().optional(),
  amountBaht: z.coerce.number().min(0, "Amount must be 0 or more"),
  interval: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  start_date: z.string().optional(),
  notes: z.string().optional(),
})

type Values = z.infer<typeof Schema>
export type SubscriptionFormSubmitValues = Values

export type SubscriptionFormValues = {
  name: string
  client_id: string
  project_id: string
  amountBaht: number
  interval: Values["interval"]
  start_date: string
  notes: string
}

export function SubscriptionForm({
  clients,
  projects,
  defaultValues,
  submitLabel,
  action,
}: {
  clients: Option[]
  projects: Option[]
  defaultValues: SubscriptionFormValues
  submitLabel: string
  action: (values: Values) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues,
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const res = await action(values)
          if (res?.error) {
            toast.error(res.error)
            return
          }
          // createSubscription redirects on success (no return); update returns {}.
          toast.success("Subscription saved")
          router.refresh()
        })}
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Acme monthly retainer" {...field} />
              </FormControl>
              <FormDescription>
                Shown on generated invoices as the number prefix.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            name="client_id"
            label="Client"
            placeholder="Select a client"
            options={clients}
          />
          <SelectField
            name="project_id"
            label="Project"
            placeholder="No project"
            options={projects}
            optional
            noneLabel="No project"
            description="Optional — link to a project."
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="amountBaht"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount (฿)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={(field.value ?? "") as number | string}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>Billed each interval.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <SelectField
            name="interval"
            label="Interval"
            placeholder="Select interval"
            options={INTERVAL_OPTIONS}
          />
          <FormField
            control={form.control}
            name="start_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormDescription>First run date.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Anything worth remembering about this subscription…"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}
