"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"

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
}

const Schema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

type Values = z.infer<typeof Schema>

export function InvoiceItemsEditor({
  invoiceId,
  items,
  addAction,
  deleteAction,
}: {
  invoiceId: string
  items: InvoiceItemRow[]
  addAction: (input: {
    invoice_id: string
    description: string
    quantity: number
    unitPriceBaht: number
  }) => Promise<{ error?: string }>
  deleteAction: (input: { id: string }) => Promise<{ error?: string }>
}) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      description: "",
      quantity: 1,
      unitPriceBaht: 0,
    },
  })

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
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10" />
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
                <TableCell className="text-right tabular-nums">
                  {item.amount}
                </TableCell>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">
          No line items yet. Add one below to itemize this invoice — the invoice
          total is then derived from the items.
        </p>
      )}

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            const res = await addAction({ invoice_id: invoiceId, ...values })
            if (res?.error) {
              toast.error(res.error)
              return
            }
            toast.success("Line item added")
            form.reset({ description: "", quantity: 1, unitPriceBaht: 0 })
            router.refresh()
          })}
          className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-start"
        >
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
          <div className="flex flex-col justify-end sm:pt-[1.625rem]">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Add item
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
