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
  FormDescription,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { UpdateOrgSettingsInput } from "../actions"

// The form keeps the baht fields as raw strings (so the burn field can be left
// blank to clear the override, and `field.value` stays a string for <Input>).
// Numbers are coerced when we call the action, which re-validates with zod and
// is the source of truth.
const isMoney = (v: string) => {
  const t = v.trim()
  return t !== "" && Number.isFinite(Number(t)) && Number(t) >= 0
}

const FormSchema = z.object({
  orgName: z.string().min(1, "Workspace name is required"),
  cashBalanceBaht: z
    .string()
    .refine(isMoney, "Enter a valid amount (0 or more)"),
  monthlyBurnBaht: z
    .string()
    .refine(
      (v) => v.trim() === "" || isMoney(v),
      "Enter a valid amount (0 or more)"
    ),
})

type FormValues = z.infer<typeof FormSchema>

export function SettingsForm({
  defaultOrgName,
  defaultCashBaht,
  defaultBurnBaht,
  action,
}: {
  defaultOrgName: string
  defaultCashBaht: number
  defaultBurnBaht: number | null
  action: (input: UpdateOrgSettingsInput) => Promise<{ error?: string }>
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      orgName: defaultOrgName,
      cashBalanceBaht: String(defaultCashBaht),
      monthlyBurnBaht: defaultBurnBaht === null ? "" : String(defaultBurnBaht),
    },
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const burn = values.monthlyBurnBaht.trim()
          const res = await action({
            orgName: values.orgName,
            cashBalanceBaht: Number(values.cashBalanceBaht),
            monthlyBurnBaht: burn === "" ? undefined : Number(burn),
          })
          if (res?.error) return toast.error(res.error)
          toast.success("Settings saved")
        })}
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="orgName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workspace name</FormLabel>
              <FormControl>
                <Input placeholder="BoomBigNose" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="cashBalanceBaht"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cash balance (฿)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Your current bank balance. Powers cash &amp; runway on the dashboard.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="monthlyBurnBaht"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Monthly burn override (฿)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Leave blank to use actual burn"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Optional. Set a fixed monthly burn for runway; leave blank to use
                your actual recorded costs.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Form>
  )
}
