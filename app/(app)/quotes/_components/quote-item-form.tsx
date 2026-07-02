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

import { addQuoteItem } from "../actions"

const Schema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

type Values = z.infer<typeof Schema>

export function QuoteItemForm({ quoteId }: { quoteId: string }) {
  const router = useRouter()
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      description: "",
      quantity: 1,
      unitPriceBaht: 0,
    },
  })

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
