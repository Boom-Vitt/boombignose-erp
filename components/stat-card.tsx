import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type StatCardProps = {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: "default" | "positive" | "negative" | "warning"
  className?: string
}

const VALUE_TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: StatCardProps) {
  return (
    <Card className={cn("gap-0", className)}>
      <CardContent className="flex flex-col gap-1 p-5">
        <div className="text-muted-foreground flex items-center justify-between text-sm font-medium">
          <span>{label}</span>
          {Icon ? <Icon className="size-4 opacity-70" aria-hidden /> : null}
        </div>
        <div className={cn("text-2xl font-semibold tracking-tight", VALUE_TONE[tone])}>
          {value}
        </div>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
