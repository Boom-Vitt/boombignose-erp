"use client"

import { useEffect } from "react"
import { useForm, useWatch } from "react-hook-form"
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
import { RecordFields, useGuardedForm } from "@/components/record/record-guard"

import { serviceMoneyInput } from "@/lib/workflows/service"

import { SelectField, type Option } from "./form-fields"
import type { DealOption } from "@/app/(app)/deals/_lib/deal-options"

const Schema = z.object({
  client_id: z.string().min(1, "Choose a client"),
  project_id: z.string().optional(),
  deal_id: z.string().optional(),
  number: z.string().optional(),
  issue_date: z.string().optional(),
  valid_until: z.string().optional(),
  discountBaht: serviceMoneyInput,
  notes: z.string().optional(),
})

type Values = z.infer<typeof Schema>
/** The exact payload shape `action` receives on submit (Zod output of the form). */
export type QuoteFormSubmitValues = Values

export type QuoteFormValues = {
  client_id: string
  project_id: string
  deal_id: string
  number: string
  issue_date: string
  valid_until: string
  discountBaht: number | string
  notes: string
}

export function QuoteForm({
  clients,
  projects,
  deals,
  defaultValues,
  submitLabel,
  action,
}: {
  clients: Option[]
  projects: Option[]
  deals: DealOption[]
  defaultValues: QuoteFormValues
  submitLabel: string
  action: (values: Values) => Promise<{ error?: string } | void>
}) {
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues,
  })
  // A quote can only link to a deal of its own client, so a client change drops a foreign deal.
  const clientId = useWatch({ control: form.control, name: "client_id" })
  useEffect(() => {
    const dealId = form.getValues("deal_id")
    if (dealId && !deals.some((d) => d.value === dealId && d.clientId === clientId)) form.setValue("deal_id", "")
  }, [clientId, deals, form])
  const onSubmit = useGuardedForm(form, async (values) => {
    const res = await action(values)
    if (res?.error) {
      toast.error(res.error)
      return false
    }
    // createQuote redirects on success (no return); update returns {}.
    toast.success("Quote saved")
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
          <SelectField
            name="deal_id"
            label="Deal"
            placeholder="No deal"
            options={deals.filter((d) => d.clientId === clientId)}
            optional
            noneLabel="No deal"
            description="Optional — the deal this quote is for."
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Quote number</FormLabel>
                <FormControl>
                  <Input placeholder="Auto (QUO-2026-00X)" {...field} />
                </FormControl>
                <FormDescription>
                  Leave blank to auto-number.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="discountBaht"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Discount (฿)</FormLabel>
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
                <FormDescription>Absolute amount off the subtotal.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="issue_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Issue date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="valid_until"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Valid until</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
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
                  placeholder="Scope, assumptions, terms…"
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
