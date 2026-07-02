"use client"

import { useState, useTransition } from "react"
import { BookmarkPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"

import { createSavedView } from "./actions"
import { isEmptyConfig, type ViewConfig } from "./view-config"

/**
 * "Save this view" control. Captures the currently-active filters (passed in as
 * `config`) under a name. Disabled when no filter is active — there's nothing
 * worth saving for the default, unfiltered view.
 */
export function SaveViewButton({
  module,
  config,
}: {
  module: "deals" | "finance" | "clients"
  config: ViewConfig
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [pending, startTransition] = useTransition()
  const noFilters = isEmptyConfig(config)

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Give your view a name")
      return
    }
    startTransition(async () => {
      const res = await createSavedView({ module, name: trimmed, config })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Saved view “${trimmed}”`)
      setName("")
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={noFilters}>
            <BookmarkPlus />
            Save view
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
          <DialogDescription>
            Save the current filters so you can jump back to them later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="saved-view-name">View name</Label>
          <Input
            id="saved-view-name"
            value={name}
            placeholder="e.g. Hot deals"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSave()
              }
            }}
          />
        </div>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            }
          />
          <Button size="sm" disabled={pending} onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
