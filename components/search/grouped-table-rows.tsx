import { Fragment, type ReactNode } from "react"
import { groupFacetRows } from "@/lib/search-facets"
import { formatTHB } from "@/lib/money"
import { TableCell, TableRow } from "@/components/ui/table"

export function GroupedTableRows<T>({ rows, group, amount, colSpan, children }: {
  rows: T[]
  group?: (row: T) => { key: string; label: string }
  amount?: (row: T) => number
  colSpan: number
  children: (row: T) => ReactNode
}) {
  return groupFacetRows(rows, group, amount).map((section) => (
    <Fragment key={section.key}>
      {group && <TableRow className="bg-muted/50" data-testid="group-header">
        <TableCell colSpan={colSpan}>
          <span className="font-semibold">{section.label}</span>
          <span className="ml-2 text-muted-foreground">({section.rows.length})</span>
          {section.totalSatang !== undefined && <span className="float-right tabular-nums">{formatTHB(section.totalSatang)}</span>}
        </TableCell>
      </TableRow>}
      {section.rows.map(children)}
    </Fragment>
  ))
}
