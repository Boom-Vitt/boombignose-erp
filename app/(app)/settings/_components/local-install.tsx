"use client"

import { useState, useTransition } from "react"
import { START_LOGS } from "@/lib/install/log-names"
import { APP_VERSION } from "@/lib/release/version"
import type { UpdateCheck } from "@/lib/release/update-check"
import { Button } from "@/components/ui/button"
import { checkForUpdate, readLocalLog } from "../local-actions"

export function UpdateCheckButton() {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<UpdateCheck | null>(null)
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Installed version {APP_VERSION}. This check runs only when you ask. It does not download an installer.</p>
    <Button type="button" disabled={pending} onClick={() => start(async () => setResult(await checkForUpdate()))}>{pending ? "Checking…" : "Check for updates"}</Button>
    {result?.state === "available" ? <p className="text-sm">Version {result.version} is published. <a className="underline" href={result.url} target="_blank" rel="noopener noreferrer">Open the release page</a></p> : null}
    {result?.state === "current" ? <p className="text-sm">This install matches the published release. <a className="underline" href={result.url} target="_blank" rel="noopener noreferrer">Open the release page</a></p> : null}
    {result?.state === "unavailable" ? <p role="alert" className="text-sm">{result.message}</p> : null}
  </div>
}

export function StartLogViewer() {
  const [name, setName] = useState<(typeof START_LOGS)[number]>("server.log")
  const [pending, start] = useTransition()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState("")
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Postgres, auth, and API start logs from this computer. Database URLs and tokens are hidden. Nothing is sent over the network.</p>
    <label className="block text-sm">Log<select className="mt-1 block h-9 rounded-md border bg-background px-2" value={name} onChange={event => setName(event.target.value as (typeof START_LOGS)[number])}>{START_LOGS.map(log => <option key={log} value={log}>{log}</option>)}</select></label>
    <Button type="button" disabled={pending} onClick={() => start(async () => {
      const result = await readLocalLog(name)
      if ("error" in result) { setError(result.error); setText(null); return }
      setError(""); setText(result.text || "(empty)")
    })}>{pending ? "Reading…" : "Show log"}</Button>
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
    {text !== null ? <pre className="max-h-80 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">{text}</pre> : null}
  </div>
}
