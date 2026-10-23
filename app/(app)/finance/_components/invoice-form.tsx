"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { moneyInput } from "@/lib/payments/input"
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
import { RecordFields, useGuardedForm } from "@/components/record/record-guard"
import { Switch } from "@/components/ui/switch"

import { SelectField, type Option } from "./form-fields"

const INTERVAL_OPTIONS: Option[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
]

const Schema = z
  .object({
    client_id: z.string().min(1, "Choose a client"),
    project_id: z.string().optional(),
    number: z.string().optional(),
    issue_date: z.string().optional(),
    due_date: z.string().optional(),
    amountBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter an exact THB amount with up to two decimals"),
    is_recurring: z.boolean(),
    recurring_interval: z
      .enum(["weekly", "monthly", "quarterly", "yearly"])
      .optional(),
    notes: z.string().optional(),
  })
  .refine((v) => !v.is_recurring || !!v.recurring_interval, {
    path: ["recurring_interval"],
    message: "Pick an interval for recurring invoices",
  })

type Values = z.infer<typeof Schema>
/** The exact payload shape `action` receives on submit (Zod output of the form
 * schema — note `project_id` is optional here, unlike `InvoiceFormValues`). */
export type InvoiceFormSubmitValues = Values

export type InvoiceFormValues = {
  client_id: string
  project_id: string
  number: string
  issue_date: string
  due_date: string
  amountBaht: string
  is_recurring: boolean
  recurring_interval?: Values["recurring_interval"]
  notes: string
}

export function InvoiceForm({
  clients,
  projects,
  defaultValues,
  submitLabel,
  action,
}: {
  clients: Option[]
  projects: Option[]
  defaultValues: InvoiceFormValues
  submitLabel: string
  action: (values: Values) => Promise<{ error?: string } | void>
}) {
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues,
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- watch() is RHF's intended API
  const isRecurring = form.watch("is_recurring")
  const onSubmit = useGuardedForm(form, async (values) => {
    const payload = {
      ...values,
      recurring_interval: values.is_recurring
        ? values.recurring_interval
        : undefined,
    }
    const res = await action(payload)
    if (res?.error) {
      toast.error(res.error)
      return false
    }
    // createInvoice redirects on success (no return); update returns {}.
    toast.success("Invoice saved")
    return true
  })

  return (
    <Form {...form}>
      <RecordFields>
      <form
        onSubmit={onSubmit}
        className="space-y-5"
      >
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

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Draft reference (optional)</FormLabel>
                <FormControl>
                  <Input placeholder="Assigned on issue" {...field} />
                </FormControl>
                <FormDescription>
                  The issued invoice number is assigned by the issue command.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="issue_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Draft date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormDescription>Issuing replaces this with today in Bangkok.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="due_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Due date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
                <FormDescription>Entered in baht.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="is_recurring"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel>Recurring invoice</FormLabel>
                <FormDescription>
                  Bills the client on a repeating schedule.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {isRecurring ? (
          <SelectField
            name="recurring_interval"
            label="Recurring interval"
            placeholder="Select interval"
            options={INTERVAL_OPTIONS}
          />
        ) : null}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Anything worth remembering about this invoice…"
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
      </RecordFields>
    </Form>
  )
}
