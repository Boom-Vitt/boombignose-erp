"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

export function ProductsToolbar({ search, status }: { search: string; status: string }) {
  return <form className="flex flex-wrap items-end gap-3" action="/products">
    <div className="space-y-2">
      <label htmlFor="product-search" className="text-sm font-medium">Search name or SKU</label>
      <Input id="product-search" name="q" defaultValue={search} placeholder="Search products..." />
    </div>
    <div className="space-y-2">
      <label htmlFor="product-status" className="text-sm font-medium">Status</label>
      <Select name="status" defaultValue={status}>
        <SelectTrigger id="product-status"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="archived">Archived</SelectItem><SelectItem value="all">All</SelectItem></SelectContent>
      </Select>
    </div>
    <Button type="submit" variant="outline">Apply</Button>
  </form>
}
