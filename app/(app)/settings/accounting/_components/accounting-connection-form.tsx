"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plug, Unplug } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  connectAccounting,
  disconnectAccounting,
  type ConnectAccountingInput,
} from "../actions"

type ProviderKey = ConnectAccountingInput["provider"]

const PROVIDER_OPTIONS: { value: ProviderKey; label: string }[] = [
  { value: "flowaccount", label: "FlowAccount" },
  { value: "peak", label: "PEAK" },
  { value: "xero", label: "Xero" },
]

/**
 * Owner/admin controls for the org's accounting connection. When connected,
 * shows a Disconnect button; otherwise a provider picker + Connect. There is no
 * OAuth handshake in this MVP — connecting just records intent so invoices can
 * be scaffold-synced.
 */
export function AccountingConnectionForm({
  connectedProvider,
}: {
  connectedProvider: ProviderKey | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [provider, setProvider] = useState<ProviderKey>(
    connectedProvider ?? "flowaccount"
  )

  const isConnected = connectedProvider !== null

  if (isConnected) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Disconnecting stops new invoice syncs. Existing sync records are kept.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await disconnectAccounting()
              if (res?.error) {
                toast.error(res.error)
                return
              }
              toast.success("Accounting provider disconnected")
              router.refresh()
            })
          }
        >
          <Unplug /> {pending ? "Disconnecting…" : "Disconnect"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="provider">
          Provider
        </label>
        <Select
          value={provider}
          onValueChange={(v: string | null) =>
            setProvider((v as ProviderKey) ?? "flowaccount")
          }
        >
          <SelectTrigger id="provider" className="w-full sm:w-56">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await connectAccounting({ provider })
            if (res?.error) {
              toast.error(res.error)
              return
            }
            toast.success("Accounting provider connected")
            router.refresh()
          })
        }
      >
        <Plug /> {pending ? "Connecting…" : "Connect"}
      </Button>
    </div>
  )
}
