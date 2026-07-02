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
  FormDescription,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

import { SelectField } from "./form-fields"

const Schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  kind: z.enum(["service", "good"]),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

type Values = z.infer<typeof Schema>
/** The exact payload shape `action` receives on submit (Zod output of the form). */
export type ProductFormSubmitValues = Values

export type ProductFormValues = {
  name: string
  description: string
  kind: "service" | "good"
  unitPriceBaht: number
}

const KIND_OPTIONS = [
  { value: "service", label: "Service" },
  { value: "good", label: "Good" },
]

export function ProductForm({
  defaultValues,
  submitLabel,
  action,
}: {
  defaultValues: ProductFormValues
  submitLabel: string
  action: (values: Values) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues,
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const res = await action(values)
          if (res?.error) {
            toast.error(res.error)
            return
          }
          // createProduct redirects on success (no return); update returns {}.
          toast.success("Catalog item saved")
          router.refresh()
        })}
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Design sprint" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            name="kind"
            label="Type"
            placeholder="Select a type"
            options={KIND_OPTIONS}
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
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={(field.value ?? "") as number | string}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>Default price used on quotes and invoices.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Optional — prefilled as the line-item description."
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
