"use client"

import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type Option = { value: string; label: string }

const NONE = "__none__"

/**
 * A react-hook-form-bound Base UI Select rendered inside a FormItem. Local copy
 * of the finance module's helper so the catalog stays self-contained.
 *
 * `control` is intentionally omitted — FormField (Controller) reads it from the
 * surrounding <Form> (FormProvider) context.
 */
export function SelectField({
  name,
  label,
  placeholder,
  options,
  optional,
  noneLabel = "None",
  description,
}: {
  name: string
  label: string
  placeholder: string
  options: Option[]
  optional?: boolean
  noneLabel?: string
  description?: string
}) {
  return (
    <FormField
      name={name}
      render={({ field }) => {
        const isEmpty = field.value === "" || field.value == null
        const current = isEmpty
          ? optional
            ? NONE
            : undefined
          : String(field.value)
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <Select
                value={current}
                onValueChange={(v: string | null) =>
                  field.onChange(v === NONE || v == null ? "" : v)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {optional ? (
                    <SelectItem value={NONE}>{noneLabel}</SelectItem>
                  ) : null}
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
