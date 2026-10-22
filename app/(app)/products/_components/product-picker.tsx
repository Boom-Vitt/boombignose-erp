"use client"

import { useEffect, useId, useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import type { ProductOption } from "@/lib/products/snapshot"
import { Button } from "@/components/ui/button"
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command"
import { activeProductOptions } from "@/lib/products/queries"
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
  const [selection, setSelection] = useState<ProductOption | null>(null)
  const [result, setResult] = useState<{ search: string; products: ProductOption[]; error?: string } | null>({ search: "", products })
  const [retry, setRetry] = useState(0)
  const loading = result?.search !== search
  const options = loading ? [] : result?.products ?? []
  const selected = selection?.id === value ? selection : products.find(product => product.id === value)

  useEffect(() => {
    if (!open) return
    let current = true
    const timer = setTimeout(async () => {
      try {
        const matches = await activeProductOptions(search)
        if (current) setResult({ search, products: matches })
      } catch {
        if (current) setResult({ search, products: [], error: "Unable to search products. Please retry." })
      }
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [open, search, retry])
  return (
    <div className="space-y-2">
      <label id={`${id}-label`} className="text-sm font-medium">Product (optional)</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button type="button" variant="outline" role="combobox" aria-haspopup="dialog" aria-labelledby={`${id}-label`} aria-expanded={open} aria-controls={open ? `${id}-popup` : undefined} className="w-full justify-between" />}>
          {selected?.name ?? (value ? "Saved product" : "Free-text line")}
          <ChevronsUpDown className="opacity-50" />
        </PopoverTrigger>
        <PopoverContent id={`${id}-popup`} aria-labelledby={`${id}-label`} className="w-80 p-0" align="start">
          <Command label="Search products by name or SKU" shouldFilter={false}>
            <CommandInput aria-label="Search products by name or SKU" placeholder="Search products or SKU..." maxLength={200} value={search} onValueChange={setSearch} />
            <CommandList aria-busy={loading}>
              {loading && <p role="status" className="p-2 text-sm">Searching products...</p>}
              {!loading && result?.error && <div className="p-2"><p role="alert">{result.error}</p><Button type="button" variant="ghost" onClick={() => { setResult(null); setRetry(retry + 1) }}>Retry</Button></div>}
              {!loading && !result?.error && options.length === 0 && <p role="status" className="p-2 text-sm">No matching products.</p>}
              <CommandGroup>
                <CommandItem value="free-text-line" onSelect={() => { onChange(null); setOpen(false) }}>Free-text line</CommandItem>
                {options.map(product => (
                  <CommandItem key={product.id} value={product.id} onSelect={() => { setSelection(product); onChange(product); setOpen(false) }}>
                    <div><p>{product.name}</p>{product.sku && <p className="text-xs text-muted-foreground">{product.sku}</p>}</div>
                    {value === product.id && <Check className="ml-auto" />}
                  </CommandItem>
                ))}
              </CommandGroup>
              {options.length === 20 && <p className="p-2 text-xs text-muted-foreground">Showing up to 20 products. Type to narrow the results.</p>}
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
          <ProductForm defaults={{ name: search }} onSaved={product => { setSelection(product); onChange(product); setCreating(false) }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
