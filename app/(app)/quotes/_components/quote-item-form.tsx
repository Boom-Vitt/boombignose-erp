"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { addQuoteItem } from "../actions"

/** An active catalog product offered as a quick-fill for a line item. */
export type CatalogOption = {
  id: string
  name: string
  description: string | null
  unitPriceBaht: number
}

const Schema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

type Values = z.infer<typeof Schema>

export function QuoteItemForm({
  quoteId,
  products = [],
}: {
  quoteId: string
  /** Active catalog products; picking one prefills description + unit price. */
  products?: CatalogOption[]
}) {
  const router = useRouter()
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      description: "",
      quantity: 1,
      unitPriceBaht: 0,
    },
  })

  function applyProduct(productId: string) {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    form.setValue("description", product.description || product.name, {
      shouldValidate: true,
    })
    form.setValue("unitPriceBaht", product.unitPriceBaht, {
      shouldValidate: true,
    })
  }

  return (
    <Form {...form}>
      {products.length > 0 ? (
        <div className="mb-3 sm:max-w-xs">
          <label className="text-sm font-medium">Add from catalog</label>
          <Select onValueChange={(v: string | null) => v && applyProduct(v)}>
            <SelectTrigger className="mt-1 w-full">
              <SelectValue placeholder="Pick a product or service…" />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const res = await addQuoteItem({ quote_id: quoteId, ...values })
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success("Item added")
          form.reset({ description: "", quantity: 1, unitPriceBaht: 0 })
          router.refresh()
        })}
        className="grid items-start gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
      >
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
        <div className="flex items-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            <Plus /> Add
          </Button>
        </div>
      </form>
    </Form>
  )
}
