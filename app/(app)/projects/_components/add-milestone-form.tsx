"use client"

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
import { addMilestone } from "../actions"

const Schema = z.object({
  title: z.string().min(1, "Milestone title is required"),
  dueDate: z.string(),
})
type Values = z.infer<typeof Schema>

export function AddMilestoneForm({ projectId }: { projectId: string }) {
  const form = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: { title: "", dueDate: "" },
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (v) => {
          const res = await addMilestone({ projectId, ...v })
          if (res?.error) return toast.error(res.error)
          toast.success("Milestone added")
          form.reset({ title: "", dueDate: "" })
        })}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormLabel className="sr-only">Milestone title</FormLabel>
              <FormControl>
                <Input placeholder="Add a milestone…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="dueDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">Due date</FormLabel>
              <FormControl>
                <Input type="date" className="w-full sm:w-40" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          <Plus data-icon="inline-start" /> Add milestone
        </Button>
      </form>
    </Form>
  )
}
