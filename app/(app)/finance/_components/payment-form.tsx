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
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

import { recordPayment } from "../actions"
import { SelectField, type Option } from "./form-fields"

const METHOD_OPTIONS: Option[] = [
  { value: "transfer", label: "Bank transfer" },
  { value: "promptpay", label: "PromptPay" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
]

const Schema = z.object({
  amountBaht: z.coerce.number().positive("Amount must be greater than 0"),
  paid_at: z.string().optional(),
  method: z.enum(["transfer", "cash", "card", "promptpay", "cheque", "other"]),
})

type Values = z.infer<typeof Schema>

export function PaymentForm({
  invoiceId,
  today,
  suggestedBaht,
}: {
  invoiceId: string
  today: string
  suggestedBaht: number
}) {
  const router = useRouter()
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      amountBaht: suggestedBaht,
      paid_at: today,
      method: "transfer",
    },
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const res = await recordPayment({ invoice_id: invoiceId, ...values })
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success("Payment recorded")
          form.reset({ amountBaht: 0, paid_at: today, method: values.method })
          router.refresh()
        })}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-3">
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
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="paid_at"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Paid at</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SelectField
            name="method"
            label="Method"
            placeholder="Select method"
            options={METHOD_OPTIONS}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Record payment
          </Button>
        </div>
      </form>
    </Form>
  )
}
