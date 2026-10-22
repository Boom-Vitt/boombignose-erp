"use client"

import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus } from "lucide-react"

import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

import { addQuoteItem } from "../actions"
import { serviceMoneyInput, serviceQuantityInput } from "@/lib/workflows/service"
import { ProductLineInput } from "@/lib/products/schema"
import { productToLineValues, type ProductOption } from "@/lib/products/snapshot"
import { ProductPicker } from "../../products/_components/product-picker"

const Schema = z.object({
  ...ProductLineInput.shape,
  tax_rate_bps: z.number().int().min(0).max(10000),
  description: z.string().min(1, "Description is required"),
  quantity: serviceQuantityInput,
  unitPriceBaht: serviceMoneyInput,
})

type Values = z.infer<typeof Schema>

export function QuoteItemForm({ quoteId, products = [], canManageProducts = false, defaultTaxRate = 0 }: {
  quoteId: string
  products?: ProductOption[]
  defaultTaxRate?: number
  canManageProducts?: boolean
}) {
  const router = useRouter()
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      description: "",
      quantity: 1,
      unitPriceBaht: 0,
      product_id: null,
      unit: "piece",
      tax_rate_bps: defaultTaxRate,
    },
  })
  const selectedProductId = useWatch({ control: form.control, name: "product_id" })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const res = await addQuoteItem({ quote_id: quoteId, ...values })
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success("Item added")
          form.reset({ description: "", quantity: 1, unitPriceBaht: 0, product_id: null, unit: "piece", tax_rate_bps: defaultTaxRate })
          router.refresh()
        })}
        className="grid items-start gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]"
      >
        <div className="sm:col-span-full">
          <ProductPicker products={products} value={selectedProductId} canManage={canManageProducts} onChange={product => {
            if (!product) { form.setValue("product_id", null); form.setValue("tax_rate_bps", defaultTaxRate); return }
            const values = productToLineValues(product)
            form.setValue("product_id", values.product_id)
            form.setValue("description", values.description, { shouldValidate: true })
            form.setValue("unitPriceBaht", values.unitPriceBaht, { shouldValidate: true })
            form.setValue("unit", values.unit, { shouldValidate: true })
              form.setValue("tax_rate_bps", product.tax_rate_bps ?? defaultTaxRate, { shouldValidate: true })
          }} />
        </div>
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder="Design sprint, week 1…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="quantity"
          render={({ field }) => (
            <FormItem className="sm:w-24">
              <FormLabel>Qty</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={(field.value ?? "") as number | string}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="unit"
          render={({ field }) => <FormItem className="sm:w-24"><FormLabel>Unit</FormLabel><FormControl><Input {...field} value={field.value ?? ""} maxLength={40} /></FormControl><FormMessage /></FormItem>}
        />
        <FormField
          control={form.control}
          name="unitPriceBaht"
          render={({ field }) => (
            <FormItem className="sm:w-32">
              <FormLabel>Unit price (฿)</FormLabel>
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
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField control={form.control} name="tax_rate_bps" render={({ field }) => (
          <FormItem className="sm:w-32"><FormLabel>VAT rate (bps)</FormLabel><FormControl><Input type="number" min={0} max={10000} step={1} {...field} onChange={event => field.onChange(Number(event.target.value))} /></FormControl><p className="text-xs text-muted-foreground">700 = 7%</p><FormMessage /></FormItem>
        )} />
        <div className="flex items-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            <Plus /> Add
          </Button>
        </div>
      </form>
    </Form>
  )
}
