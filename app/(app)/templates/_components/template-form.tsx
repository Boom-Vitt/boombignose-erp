"use client"

import * as React from "react"
import Link from "next/link"
import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Tables } from "@/lib/types/database"

type Category = Pick<Tables<"template_categories">, "id" | "name">

const NONE = "__none__"

const FormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  categoryId: z.string(),
  description: z.string(),
  internalValueBaht: z.coerce.number().min(0, "Must be 0 or more"),
  priceBaht: z.coerce.number().min(0, "Must be 0 or more"),
  reusableNotes: z.string(),
  checklist: z.array(z.object({ value: z.string() })),
  tags: z.string(),
})

type FormValues = z.infer<typeof FormSchema>

export type TemplateFormDefaults = {
  name?: string
  categoryId?: string | null
  description?: string | null
  internalValueBaht?: number | null
  priceBaht?: number | null
  reusableNotes?: string | null
  checklist?: string[]
  tags?: string[]
}

type SubmitPayload = {
  name: string
  categoryId: string | null
  description: string | null
  internalValueBaht: number | null
  priceBaht: number | null
  reusableNotes: string | null
  implementationChecklist: string[]
  tags: string[]
}

export function TemplateForm({
  categories,
  defaults,
  action,
  submitLabel,
}: {
  categories: Category[]
  defaults?: TemplateFormDefaults
  action: (payload: SubmitPayload) => Promise<{ error?: string }>
  submitLabel: string
}) {
  const form = useForm<z.input<typeof FormSchema>, unknown, FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: defaults?.name ?? "",
      categoryId: defaults?.categoryId ?? NONE,
      description: defaults?.description ?? "",
      internalValueBaht: defaults?.internalValueBaht ?? 0,
      priceBaht: defaults?.priceBaht ?? 0,
      reusableNotes: defaults?.reusableNotes ?? "",
      checklist:
        defaults?.checklist && defaults.checklist.length > 0
          ? defaults.checklist.map((value) => ({ value }))
          : [{ value: "" }],
      tags: defaults?.tags?.join(", ") ?? "",
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "checklist",
  })

  async function onSubmit(values: FormValues) {
    const payload: SubmitPayload = {
      name: values.name.trim(),
      categoryId: values.categoryId === NONE ? null : values.categoryId,
      description: values.description.trim() || null,
      internalValueBaht: values.internalValueBaht,
      priceBaht: values.priceBaht,
      reusableNotes: values.reusableNotes.trim() || null,
      implementationChecklist: values.checklist
        .map((s) => s.value.trim())
        .filter(Boolean),
      tags: values.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    }
    const res = await action(payload)
    // On success the action redirects; only an error returns here.
    if (res?.error) toast.error(res.error)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. LINE Sales-Support Bot" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No category">
                      {(value) =>
                        value && value !== NONE
                          ? (categories.find((c) => c.id === value)?.name ??
                            "No category")
                          : "No category"
                      }
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="What does this automation do?"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="internalValueBaht"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Internal value (฿)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={(field.value ?? "") as number | string}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>What it saves / is worth to us.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="priceBaht"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Price (฿)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={(field.value ?? "") as number | string}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>What we charge a client.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="reusableNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reusable notes</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="How to reuse this across clients."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-3">
          <div className="space-y-1">
            <FormLabel>Implementation checklist</FormLabel>
            <p className="text-muted-foreground text-sm">
              The steps to ship this for a client. Add or remove rows.
            </p>
          </div>
          <div className="space-y-2">
            {fields.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  placeholder={`Step ${index + 1}`}
                  {...form.register(`checklist.${index}.value` as const)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove step"
                  onClick={() => (fields.length > 1 ? remove(index) : form.setValue(`checklist.${index}.value`, ""))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ value: "" })}
          >
            <Plus /> Add step
          </Button>
        </div>

        <FormField
          control={form.control}
          name="tags"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tags</FormLabel>
              <FormControl>
                <Input placeholder="line, bot, n8n" {...field} />
              </FormControl>
              <FormDescription>Comma-separated.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
          <Button type="button" variant="ghost" render={<Link href="/templates" />}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  )
}
