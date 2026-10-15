"use client"

import { Boxes, LayoutGrid } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import { WarehouseApp } from "@/components/warehouse/warehouse-app"
import { SidebarInset } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

export type ViewMode = "2d" | "3d"

const STORAGE_KEY = "bignose-view-mode"

type ViewModeCtx = {
  mode: ViewMode
  setMode: (mode: ViewMode) => void
  ready: boolean
}

const Ctx = createContext<ViewModeCtx | null>(null)

export function useViewMode(): ViewModeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useViewMode requires ViewModeProvider")
  return ctx
}

// Survives private mode, where localStorage throws.
let memoryMode: ViewMode | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function readMode(): ViewMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "2d" || saved === "3d") return saved
  } catch {
    /* private mode */
  }
  return memoryMode ?? "2d"
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  // Server snapshot is null: the saved mode is unknown until hydration, so `ready` stays false.
  const stored = useSyncExternalStore(subscribe, readMode, () => null)
  const mode = stored ?? "2d"
  const ready = stored !== null

  const setMode = useCallback((next: ViewMode) => {
    memoryMode = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    listeners.forEach((listener) => listener())
  }, [])

  const value = useMemo(() => ({ mode, setMode, ready }), [mode, setMode, ready])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Segmented 2D / 3D control — FB BoomBigNose chrome. */
export function ViewModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useViewMode()
  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-card/90 p-0.5 shadow-sm backdrop-blur",
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={mode === "2d"}
        onClick={() => setMode("2d")}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
          mode === "2d"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <LayoutGrid className="size-3.5" aria-hidden />
        2D
      </button>
      <button
        type="button"
        aria-pressed={mode === "3d"}
        onClick={() => setMode("3d")}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
          mode === "3d"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Boxes className="size-3.5" aria-hidden />
        3D
      </button>
    </div>
  )
}

/**
 * Shell switch: 2D = classic tab ERP; 3D = full campus in one space (no page hop).
 * Toggle lives in the 2D toolbar and floats over the campus in 3D.
 */
export function AppViewShell({
  sidebar,
  toolbarLeft,
  children,
}: {
  sidebar: ReactNode
  toolbarLeft: ReactNode
  children: ReactNode
}) {
  const { mode, ready, setMode } = useViewMode()

  if (!ready) {
    return <div className="bg-background min-h-svh w-full" aria-hidden />
  }

  if (mode === "3d") {
    return (
      <div className="relative h-svh w-full overflow-hidden">
        <WarehouseApp onOpenModule={() => setMode("2d")} />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-end p-3 md:p-4">
          <div className="pointer-events-auto">
            <ViewModeToggle />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {sidebar}
      <SidebarInset>
        <header className="erp-3d-toolbar bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          {toolbarLeft}
          <div className="ml-auto">
            <ViewModeToggle />
          </div>
        </header>
        <div className="erp-3d-stage flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </>
  )
}
