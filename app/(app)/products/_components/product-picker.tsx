"use client"

import { useId, useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import type { ProductOption } from "@/lib/products/snapshot"
import { Button } from "@/components/ui/button"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ProductForm } from "./product-form"

export function ProductPicker({ products, value, onChange, canManage = false }: {
  products: ProductOption[]
  value: string | null | undefined
  onChange: (product: ProductOption | null) => void
  canManage?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const [created, setCreated] = useState<ProductOption[]>([])
  const options = [...products, ...created.filter(p => !products.some(existing => existing.id === p.id))]
  const selected = options.find(product => product.id === value)
  return (
    <div className="space-y-2">
      <label id={`${id}-label`} className="text-sm font-medium">Product (optional)</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button type="button" variant="outline" role="combobox" aria-haspopup="dialog" aria-labelledby={`${id}-label`} aria-expanded={open} aria-controls={open ? `${id}-popup` : undefined} className="w-full justify-between" />}>
          {selected?.name ?? (value ? "Saved product" : "Free-text line")}
          <ChevronsUpDown className="opacity-50" />
        </PopoverTrigger>
        <PopoverContent id={`${id}-popup`} aria-labelledby={`${id}-label`} className="w-80 p-0" align="start">
          <Command label="Search products by name or SKU">
            <CommandInput aria-label="Search products by name or SKU" placeholder="Search products or SKU..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>No matching products.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="free-text-line" onSelect={() => { onChange(null); setOpen(false) }}>Free-text line</CommandItem>
                {options.map(product => (
                  <CommandItem key={product.id} value={`${product.name} ${product.sku ?? ""} ${product.id}`} onSelect={() => { onChange(product); setOpen(false) }}>
                    <div><p>{product.name}</p>{product.sku && <p className="text-xs text-muted-foreground">{product.sku}</p>}</div>
                    {value === product.id && <Check className="ml-auto" />}
                  </CommandItem>
                ))}
              </CommandGroup>
              {canManage && <>
                <CommandSeparator />
                <CommandGroup forceMount><CommandItem value="create-product" forceMount onSelect={() => { setOpen(false); setCreating(true) }}><Plus /> Create product</CommandItem></CommandGroup>
              </>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Create product</DialogTitle><DialogDescription>Save a catalog entry and use it on this line.</DialogDescription></DialogHeader>
          <ProductForm defaults={{ name: search }} onSaved={product => { setCreated([...created, product]); onChange(product); setCreating(false) }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
