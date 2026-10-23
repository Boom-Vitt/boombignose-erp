import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><nav aria-label="Inventory"><div className="flex flex-wrap gap-2">{[
    ["/inventory", "On hand"], ["/inventory/moves", "Moves"], ["/inventory/transfer", "Transfer"], ["/inventory/adjust", "Adjust count"], ["/inventory/warehouses", "Warehouses"], ["/inventory/replenish", "Replenishment"],
  ].map(([href, label]) => <Button key={href} variant="outline" size="sm" render={<Link href={href} />}>{label}</Button>)}</div></nav>{children}</div>
}
