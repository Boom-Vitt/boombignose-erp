"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { moneyInput, invoiceLineAmount } from "@/lib/payments/input"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import { ProductLineInput } from "@/lib/products/schema"
import { productToLineValues, type ProductOption } from "@/lib/products/snapshot"
import { ProductPicker } from "../../products/_components/product-picker"

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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

/** A display-ready line-item row (money already formatted by the RSC page). */
export type InvoiceItemRow = {
  id: string
  description: string
  quantity: string
  unitPrice: string
  amount: string
  taxRate?: string
}

const Schema = z.object({
  ...ProductLineInput.shape,
  tax_rate_bps: z.number().int().min(0).max(10000),
  description: z.string().min(1, "Description is required"),
  quantity: z.string().refine(v => { try { invoiceLineAmount(v, 0); return true } catch { return false } }, "Positive quantity, up to three decimals"),
  unitPriceBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter an exact THB amount"),
})

type Values = z.infer<typeof Schema>

export function InvoiceItemsEditor({
  invoiceId,
  items,
  addAction,
  deleteAction,
  locked = false,
  products = [],
  canManageProducts = false,
  defaultTaxRate = 0,
}: {
  invoiceId: string
  items: InvoiceItemRow[]
  addAction: (input: {
    invoice_id: string
    description: string
    quantity: string
    unitPriceBaht: string
    product_id?: string | null
    unit?: string | null
    tax_rate_bps?: number
  }) => Promise<{ error?: string }>
  deleteAction: (input: { id: string }) => Promise<{ error?: string }>
  /** When true (invoice paid), render items read-only: no add row, no delete. */
  locked?: boolean
  products?: ProductOption[]
  defaultTaxRate?: number
  canManageProducts?: boolean
}) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      description: "",
      quantity: "1",
      unitPriceBaht: "0.00",
      product_id: null,
      unit: "piece",
      tax_rate_bps: defaultTaxRate,
    },
  })
  const selectedProductId = useWatch({ control: form.control, name: "product_id" })

  async function onDelete(id: string) {
    setDeletingId(id)
    const res = await deleteAction({ id })
    setDeletingId(null)
    if (res?.error) {
      toast.error(res.error)
      return
    }
    toast.success("Line item removed")
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {locked ? null : <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.description}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantity}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.unitPrice}
                </TableCell>
                <TableCell className="text-right">{item.taxRate ?? "0%"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.amount}
                </TableCell>
                {locked ? null : (
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Delete line item"
                      disabled={deletingId === item.id}
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">
          {locked
            ? "No line items."
            : "No line items yet. Add one below to itemize this invoice — the invoice total is then derived from the items."}
        </p>
      )}

      {locked ? (
        <p className="text-muted-foreground text-sm">Locked (paid)</p>
      ) : (
        <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            const res = await addAction({ invoice_id: invoiceId, ...values })
            if (res?.error) {
              toast.error(res.error)
              return
            }
            toast.success("Line item added")
            form.reset({ description: "", quantity: "1", unitPriceBaht: "0.00", product_id: null, unit: "piece", tax_rate_bps: defaultTaxRate })
            router.refresh()
          })}
          className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto_auto_auto] sm:items-start"
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
                  <Input placeholder="e.g. Design work" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Qty</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    className="sm:w-24"
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
              <FormItem>
                <FormLabel>Unit price (฿)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    className="sm:w-32"
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
          <div className="flex flex-col justify-end sm:pt-[1.625rem]">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Add item
            </Button>
          </div>
        </form>
        </Form>
      )}
    </div>
  )
}
