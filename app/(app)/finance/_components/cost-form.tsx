"use client"

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

import { SelectField, type Option } from "./form-fields"

const CATEGORY_OPTIONS: Option[] = [
  { value: "software", label: "Software" },
  { value: "contractor", label: "Contractor" },
  { value: "infra", label: "Infrastructure" },
  { value: "marketing", label: "Marketing" },
  { value: "salary", label: "Salary" },
  { value: "other", label: "Other" },
]

const Schema = z.object({
  category: z.enum([
    "software",
    "contractor",
    "infra",
    "marketing",
    "salary",
    "other",
  ]),
  amountBaht: z.coerce.number().min(0, "Amount must be 0 or more"),
  incurred_on: z.string().optional(),
  vendor: z.string().optional(),
  project_id: z.string().optional(),
  notes: z.string().optional(),
})

type Values = z.infer<typeof Schema>

export function CostForm({
  projects,
  today,
  action,
}: {
  projects: Option[]
  today: string
  action: (values: Values) => Promise<{ error?: string } | void>
}) {
  const form = useForm<z.input<typeof Schema>, unknown, Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      category: "other",
      amountBaht: 0,
      incurred_on: today,
      vendor: "",
      project_id: "",
      notes: "",
    },
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
          toast.success("Cost saved")
        })}
        className="space-y-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            name="category"
            label="Category"
            placeholder="Select category"
            options={CATEGORY_OPTIONS}
          />
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
                <FormDescription>Entered in baht.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="incurred_on"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Incurred on</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Figma, AWS, freelancer…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <SelectField
          name="project_id"
          label="Project"
          placeholder="No project"
          options={projects}
          optional
          noneLabel="No project"
          description="Optional — attribute this cost to a project."
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="What was this for?" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Save cost
          </Button>
        </div>
      </form>
    </Form>
  )
}
