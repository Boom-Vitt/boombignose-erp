import { formatTHB } from "@/lib/money"

export function ReportChart({ title, rows, kind, unit }: {
  title: string
  rows: { label: string; value: number }[]
  kind: "bar" | "line"
  unit: "satang" | "hours"
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.value))
  const format = (value: number) => unit === "satang" ? formatTHB(value) : `${value.toFixed(2)} h`
  const x = (index: number) => (index + 0.5) * 100 / rows.length
  const y = (value: number) => 180 - (maximum > 0 ? value / maximum * 160 : 0)
  return <figure aria-label={`${title} ${kind} chart`} className="overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0}>
    <figcaption className="mb-4 text-sm text-muted-foreground">{title} · {unit === "satang" ? "THB" : "Hours"}</figcaption>
    {rows.length === 0 ? <p className="text-sm text-muted-foreground">No data in range.</p> : <div style={{ minWidth: `${Math.max(360, rows.length * 100)}px` }}>
      {kind === "line" && <svg viewBox="0 0 100 200" preserveAspectRatio="none" className="h-48 w-full text-primary" aria-hidden="true">
        <line x1="0" x2="100" y1="180" y2="180" stroke="currentColor" strokeOpacity="0.2" />
        <polyline points={rows.map((row, index) => `${x(index)},${y(row.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {rows.map((row, index) => <line key={`${index}-${row.label}`} x1={x(index)} x2={x(index)} y1={y(row.value) - 3} y2={y(row.value) + 3} stroke="currentColor" strokeWidth="4" vectorEffect="non-scaling-stroke" />)}
      </svg>}
      <ol className="grid gap-3 text-center" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((row, index) => <li key={`${index}-${row.label}`} className="space-y-2">
          <div className="text-sm font-medium tabular-nums">{format(row.value)}</div>
          {kind === "bar" && <div className="flex h-40 items-end justify-center border-b" aria-hidden="true">
            <div className="w-full max-w-16 rounded-t bg-primary" style={{ height: `${maximum > 0 ? row.value / maximum * 100 : 0}%` }} />
          </div>}
          <span className="block text-xs text-muted-foreground">{row.label}</span>
        </li>)}
      </ol>
      {maximum === 0 && <p className="mt-4 text-sm text-muted-foreground">All values are zero in this range.</p>}
    </div>}
  </figure>
}
