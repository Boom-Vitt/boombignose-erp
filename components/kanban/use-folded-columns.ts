"use client"

import { useSyncExternalStore } from "react"

import { parseFolded } from "@/lib/kanban"

// Last write per key for this tab, so folding still works when storage throws (private mode, quota).
const memory = new Map<string, string>()
const listeners = new Set<() => void>()

function read(key: string): string | null {
  const local = memory.get(key)
  if (local !== undefined) return local
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** Folded column ids, remembered per `storageKey` in localStorage. */
export function useFoldedColumns(
  storageKey: string,
  defaults: readonly string[]
): [ReadonlySet<string>, (id: string) => void] {
  // Server and hydration render the defaults; the stored value applies right after.
  const raw = useSyncExternalStore(subscribe, () => read(storageKey), () => null)
  const folded = new Set(parseFolded(raw) ?? defaults)

  function toggle(id: string) {
    const next = new Set(folded)
    if (!next.delete(id)) next.add(id)
    const value = JSON.stringify([...next])
    memory.set(storageKey, value)
    try {
      window.localStorage.setItem(storageKey, value)
    } catch {
      // Storage unavailable: the in-memory copy keeps this tab consistent.
    }
    for (const l of listeners) l()
  }

  return [folded, toggle]
}
