"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { z } from "zod"
import { ProductInput, type ProductFormValues } from "@/lib/products/schema"
import { saveProduct } from "@/lib/products/actions"
import type { ProductOption } from "@/lib/products/snapshot"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

export function ProductForm({ id, defaults, onSaved }: {
  id?: string
  defaults?: Partial<ProductFormValues>
  onSaved?: (product: ProductOption) => void
}) {
  const router = useRouter()
  const form = useForm<ProductFormValues, unknown, z.output<typeof ProductInput>>({
    resolver: zodResolver(ProductInput),
    defaultValues: {
      sku: "", name: "", description: "", type: "service", unit: "hour",
      listPriceBaht: "0.00", costBaht: "0.00", taxRateBps: 0, isStockable: false,
      ...defaults,
    },
  })
  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={event => {
        event.stopPropagation()
        void form.handleSubmit(async (values) => {
        const result = await saveProduct(values, id)
        if (result.error) { toast.error(result.error); return }
        if (!result.product) return
        toast.success(id ? "Product saved" : "Product created")
        if (onSaved) onSaved(result.product)
        else { router.push(`/products/${result.product.id}`); router.refresh() }
        })(event)
      }}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["name", "sku", "unit"] as const).map((name) => (
            <FormField key={name} control={form.control} name={name} render={({ field }) => (
              <FormItem>
                <FormLabel>{name === "name" ? "Name" : name === "sku" ? "SKU (optional)" : "Unit"}</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} maxLength={name === "name" ? 200 : name === "sku" ? 80 : 40} placeholder={name === "unit" ? "hour, day, piece, month" : undefined} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          ))}
          <FormField control={form.control} name="type" render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="w-full"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent><SelectItem value="service">Service</SelectItem><SelectItem value="goods">Goods</SelectItem></SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          {(["listPriceBaht", "costBaht"] as const).map((name) => (
            <FormField key={name} control={form.control} name={name} render={({ field }) => (
              <FormItem>
                <FormLabel>{name === "listPriceBaht" ? "Sales price (THB)" : "Cost (THB)"}</FormLabel>
                <FormControl><Input type="number" min="0" step="0.01" inputMode="decimal" {...field} value={field.value as string | number} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          ))}
          <FormField control={form.control} name="taxRateBps" render={({ field }) => (
            <FormItem>
              <FormLabel>Tax rate (basis points)</FormLabel>
              <FormControl><Input type="number" min="0" max="10000" step="1" {...field} onChange={event => field.onChange(event.target.value === "" ? NaN : Number(event.target.value))} /></FormControl>
              <p className="text-xs text-muted-foreground">100 basis points = 1%. Stored for future tax calculations.</p>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Line description (optional)</FormLabel>
            <FormControl><Textarea {...field} value={field.value ?? ""} maxLength={4000} rows={3} placeholder="Uses the product name when empty" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="isStockable" render={({ field }) => (
          <FormItem className="flex items-center gap-2">
            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
            <FormLabel>Stockable (for future inventory tracking)</FormLabel>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit" disabled={form.formState.isSubmitting}>{id ? "Save product" : "Create product"}</Button>
      </form>
    </Form>
  )
}
