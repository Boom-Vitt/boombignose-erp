"use client"

import { useRouter } from "next/navigation"
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
import { ProductPicker } from "@/app/(app)/products/_components/product-picker"
import type { ProductOption } from "@/lib/products/snapshot"
import { satangToBaht } from "@/lib/money"
import { WHT_RATES } from "@/lib/tax/totals"

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
  product_id: z.string().nullable().optional(),
  unit: z.string().trim().min(1).max(40),
  tax_rate_bps: z.number().int().min(0).max(10000).optional(),
  wht_rate_bps: z.number().int().refine(value => (WHT_RATES as readonly number[]).includes(value)).optional(),
  prices_include_vat: z.boolean(),
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
  product_id: string | null
  unit: string
  tax_rate_bps: number | undefined
  wht_rate_bps: number | undefined
  prices_include_vat: boolean
}

export function SubscriptionForm({
  clients,
  projects,
  defaultValues,
  submitLabel,
  action,
  products,
}: {
  clients: Option[]
  projects: Option[]
  defaultValues: SubscriptionFormValues
  submitLabel: string
  action: (values: Values) => Promise<{ error?: string } | void>
  products: ProductOption[]
}) {
  const router = useRouter()
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues,
  })
  const productId = useWatch({ control: form.control, name: "product_id" })

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
        <ProductPicker products={products} value={productId} onChange={product => {
          form.setValue("product_id", product?.id ?? null)
          form.setValue("tax_rate_bps", product?.tax_rate_bps)
          if (product) {
            form.setValue("unit", product.unit)
            form.setValue("amountBaht", satangToBaht(product.list_price_satang))
            if (!form.getValues("name")) form.setValue("name", product.name)
          }
        }} />
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
                Shown as the line description on generated invoices.
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
          <FormField control={form.control} name="unit" render={({ field }) => <FormItem>
            <FormLabel>Unit</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage />
          </FormItem>} />
          <FormField control={form.control} name="tax_rate_bps" render={({ field }) => <FormItem>
            <FormLabel>VAT rate (%)</FormLabel>
            <FormControl><Input type="number" min={0} max={100} step="0.01" value={field.value === undefined ? "" : field.value / 100} name={field.name} ref={field.ref} onBlur={field.onBlur} onChange={event => field.onChange(event.target.value === "" ? undefined : Math.round(Number(event.target.value) * 100))} /></FormControl>
            <FormDescription>Blank uses the product or organization default on creation.</FormDescription><FormMessage />
          </FormItem>} />
          <FormField control={form.control} name="wht_rate_bps" render={({ field }) => <FormItem>
            <FormLabel>Withholding tax</FormLabel>
            <FormControl><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={field.value ?? ""} name={field.name} ref={field.ref} onBlur={field.onBlur} onChange={event => field.onChange(event.target.value === "" ? undefined : Number(event.target.value))}>
              <option value="">Use default or saved rate</option>
              {WHT_RATES.map(rate => <option key={rate} value={rate}>{rate / 100}%</option>)}
            </select></FormControl><FormDescription>Blank uses creation defaults; edits keep the saved rate.</FormDescription><FormMessage />
          </FormItem>} />
        </div>
        <FormField control={form.control} name="prices_include_vat" render={({ field }) => <FormItem>
          <FormLabel className="flex items-center gap-2"><FormControl><input type="checkbox" name={field.name} ref={field.ref} checked={field.value} onBlur={field.onBlur} onChange={event => field.onChange(event.target.checked)} /></FormControl>Prices include VAT</FormLabel>
        </FormItem>} />

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
