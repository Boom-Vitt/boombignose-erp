"use client"

import { useEffect, useRef, useState } from "react"
import type {
  AssemblyId,
  BlueprintAssemblySpec,
  BlueprintSceneModel,
} from "@/lib/blueprint/scene-data"
import {
  createBlueprintEngine,
  type BlueprintEngine,
  type ProjectedAnchor,
} from "./scene-3d"

export function BlueprintViewer({ model }: { model: BlueprintSceneModel }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<BlueprintEngine | null>(null)

  const [sheetIndex, setSheetIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<AssemblyId | null>("01-crm-deals")
  const [exploded, setExploded] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [webglAvailable, setWebglAvailable] = useState(true)
  const [anchors, setAnchors] = useState<ProjectedAnchor[]>([])
  const [tokenStepIndex, setTokenStepIndex] = useState(0)

  const activeSheet = model.sheets[sheetIndex] ?? model.sheets[0]!
  const selectedAssembly: BlueprintAssemblySpec | null =
    model.assemblies.find((a) => a.id === selectedId) ?? null

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const initialReduced = mq.matches
    const onMotionChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches)
      engineRef.current?.setReducedMotion(e.matches)
    }
    mq.addEventListener("change", onMotionChange)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null)
        engineRef.current?.selectAssembly(null)
      }
    }
    window.addEventListener("keydown", onKeyDown)

    const host = hostRef.current
    if (!host) {
      return () => {
        mq.removeEventListener("change", onMotionChange)
        window.removeEventListener("keydown", onKeyDown)
      }
    }

    const engine = createBlueprintEngine(host, model, {
      reducedMotion: initialReduced,
      onAnchors(nextAnchors, stepIdx) {
        setAnchors(nextAnchors)
        setTokenStepIndex(stepIdx)
      },
      onSelect(id) {
        setSelectedId(id)
      },
    })

    const initTimer = window.setTimeout(() => {
      setReducedMotion(initialReduced)
      setWebglAvailable(Boolean(engine))
    }, 0)

    if (!engine) {
      return () => {
        window.clearTimeout(initTimer)
        mq.removeEventListener("change", onMotionChange)
        window.removeEventListener("keydown", onKeyDown)
      }
    }

    engineRef.current = engine
    engine.selectAssembly("01-crm-deals")

    return () => {
      window.clearTimeout(initTimer)
      mq.removeEventListener("change", onMotionChange)
      window.removeEventListener("keydown", onKeyDown)
      engine.dispose()
      engineRef.current = null
    }
  }, [model])

  function handleSelectSheet(idx: number) {
    setSheetIndex(idx)
    const sheet = model.sheets[idx]
    if (sheet) {
      setExploded(sheet.explodeFactor > 0.3)
    }
    engineRef.current?.setSheet(idx)
  }

  function handleToggleExplode(next: boolean) {
    setExploded(next)
    engineRef.current?.setExploded(next)
  }

  function handleSelectCallout(id: AssemblyId) {
    setSelectedId(id)
    engineRef.current?.selectAssembly(id)
  }

  function handleCloseDetail() {
    setSelectedId(null)
    engineRef.current?.selectAssembly(null)
  }

  return (
    <div
      data-testid="blueprint-root"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-webgl={webglAvailable ? "active" : "fallback"}
      data-exploded={exploded ? "true" : "false"}
      className="w-full max-w-full overflow-x-hidden border-2 border-[#0f2547] bg-[#f6f3ec] text-[#0f2547]"
    >
      {/* Engineering Drawing Title Block Header */}
      <header className="border-b-2 border-[#0f2547] px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-widest uppercase text-[#1e3a6d]">
              {model.titleBlock.drawingCode} / {model.titleBlock.projection}
            </p>
            <h1 className="text-base font-bold tracking-tight sm:text-xl">
              {model.titleBlock.drawingTitle}
            </h1>
            <p className="text-xs text-[#1e3a6d]" lang="th">
              {activeSheet.subtitleTh}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span
              data-testid="sheet-indicator"
              className="border border-[#0f2547] bg-[#ede8dd] px-2.5 py-1 font-semibold"
            >
              sheet {activeSheet.sheetNumber}/{activeSheet.totalSheets}
            </span>
            <span className="border border-[#0f2547] px-2.5 py-1">
              ROLE: {model.orgRole.toUpperCase()}
            </span>
            {reducedMotion && (
              <span
                data-testid="reduced-motion-badge"
                className="border border-[#0f2547] bg-[#ede8dd] px-2.5 py-1 font-semibold"
              >
                STATIC EXPLODED VIEW (REDUCED MOTION)
              </span>
            )}
          </div>
        </div>

        {/* Sheet camera states & Explode toggle */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#0f2547]/30 pt-2.5">
          <div
            role="group"
            aria-label="Drawing sheets"
            className="flex flex-wrap gap-1.5"
          >
            {model.sheets.map((s, idx) => {
              const isCurrent = idx === sheetIndex
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => handleSelectSheet(idx)}
                  aria-pressed={isCurrent}
                  className={`border border-[#0f2547] px-2.5 py-1 text-left font-mono text-xs focus-visible:ring-2 focus-visible:ring-[#0f2547] focus-visible:ring-offset-2 focus-visible:outline-none ${
                    isCurrent
                      ? "bg-[#0f2547] font-semibold text-[#f6f3ec]"
                      : "bg-[#f6f3ec] text-[#0f2547] hover:bg-[#ede8dd]"
                  }`}
                >
                  [{s.sheetNumber}/{s.totalSheets}] {s.titleEn}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
            <button
              type="button"
              onClick={() => handleToggleExplode(true)}
              aria-pressed={exploded}
              className={`border border-[#0f2547] px-2.5 py-1 focus-visible:ring-2 focus-visible:ring-[#0f2547] focus-visible:outline-none ${
                exploded
                  ? "bg-[#0f2547] font-semibold text-[#f6f3ec]"
                  : "bg-[#f6f3ec] text-[#0f2547]"
              }`}
            >
              EXPLODED
            </button>
            <button
              type="button"
              onClick={() => handleToggleExplode(false)}
              aria-pressed={!exploded}
              className={`border border-[#0f2547] px-2.5 py-1 focus-visible:ring-2 focus-visible:ring-[#0f2547] focus-visible:outline-none ${
                !exploded
                  ? "bg-[#0f2547] font-semibold text-[#f6f3ec]"
                  : "bg-[#f6f3ec] text-[#0f2547]"
              }`}
            >
              ASSEMBLED
            </button>
          </div>
        </div>
      </header>

      {/* Main Viewport + Callouts + Detail Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Axonometric Drawing Frame */}
        <div className="relative border-b-2 border-[#0f2547] lg:col-span-8 lg:border-r-2 lg:border-b-0">
          {webglAvailable ? (
            <div className="relative h-[320px] w-full overflow-hidden sm:h-[420px]">
              <div
                ref={hostRef}
                data-testid="blueprint-canvas-host"
                className="h-full w-full"
              />
              {/* SVG leader lines projected over the 3D machine */}
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                {anchors.map((a) => {
                  if (!a.visible) return null
                  const spec = model.assemblies.find((s) => s.id === a.id)
                  const isSel = selectedId === a.id
                  return (
                    <g key={a.id}>
                      <circle
                        cx={a.x}
                        cy={a.y}
                        r={isSel ? 4.5 : 3}
                        fill={isSel ? "#b44c1c" : "#0f2547"}
                      />
                      <polyline
                        points={`${a.x},${a.y} ${a.elbowX},${a.elbowY}`}
                        fill="none"
                        stroke={isSel ? "#b44c1c" : "#0f2547"}
                        strokeWidth={isSel ? 1.8 : 1.1}
                      />
                      {spec && (
                        <text
                          x={a.elbowX + (a.elbowX >= a.x ? 4 : -18)}
                          y={a.elbowY - 3}
                          fill="#0f2547"
                          fontSize="10"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {spec.partNumber}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          ) : (
            <div
              data-testid="blueprint-webgl-fallback"
              className="p-4 sm:p-6"
            >
              <div className="mb-3 flex items-center justify-between border border-[#0f2547] bg-[#ede8dd] px-3 py-2 font-mono text-xs">
                <span>STATIC AXONOMETRIC SVG POSTER (WEBGL UNAVAILABLE)</span>
                <span>SCALE: {model.titleBlock.scale}</span>
              </div>
              <svg
                role="img"
                aria-label="Static axonometric blueprint diagram of the eight ERP assemblies"
                viewBox="0 0 640 300"
                className="h-auto w-full border border-[#0f2547] bg-[#f6f3ec]"
              >
                {/* Drafting grid lines */}
                <g stroke="#cfc8b8" strokeWidth="1">
                  <line x1="40" y1="250" x2="600" y2="250" />
                  <line x1="80" y1="50" x2="80" y2="270" />
                  <line x1="320" y1="30" x2="320" y2="270" />
                  <line x1="560" y1="50" x2="560" y2="270" />
                </g>
                {/* Tenant Isolation Housing Base */}
                <polygon
                  points="80,220 320,165 560,220 320,275"
                  fill="#e4dfd2"
                  stroke="#0f2547"
                  strokeWidth="2"
                />
                <text
                  x="235"
                  y="245"
                  fill="#0f2547"
                  fontFamily="monospace"
                  fontSize="11"
                  fontWeight="bold"
                >
                  08 TENANT HOUSING (org_id + RLS)
                </text>
                {/* Exploded Assembly Blocks with Leader Callout Lines */}
                {[
                  { num: "01", label: "CRM/DEALS", x: 90, y: 70 },
                  { num: "02", label: "QUOTES", x: 195, y: 45 },
                  { num: "03", label: "PROJECTS", x: 310, y: 45 },
                  { num: "07", label: "AI UNIT", x: 445, y: 45 },
                  { num: "04", label: "INVOICES", x: 135, y: 135 },
                  { num: "05", label: "PAYMENTS", x: 285, y: 135 },
                  { num: "06", label: "SUBS/OUTBOX", x: 435, y: 135 },
                ].map((b) => (
                  <g key={b.num}>
                    <rect
                      x={b.x}
                      y={b.y}
                      width="92"
                      height="42"
                      fill="#ede8dd"
                      stroke="#0f2547"
                      strokeWidth="1.75"
                    />
                    <line
                      x1={b.x + 46}
                      y1={b.y + 42}
                      x2={b.x + 46}
                      y2="215"
                      stroke="#1e3a6d"
                      strokeDasharray="4 3"
                      strokeWidth="1"
                    />
                    <text
                      x={b.x + 8}
                      y={b.y + 18}
                      fill="#0f2547"
                      fontFamily="monospace"
                      fontSize="11"
                      fontWeight="bold"
                    >
                      [{b.num}]
                    </text>
                    <text
                      x={b.x + 8}
                      y={b.y + 33}
                      fill="#1e3a6d"
                      fontFamily="monospace"
                      fontSize="9"
                    >
                      {b.label}
                    </text>
                  </g>
                ))}
                {/* Document Token Conduit Line */}
                <polyline
                  points="241,66 356,66 181,156 331,156"
                  fill="none"
                  stroke="#b44c1c"
                  strokeWidth="2"
                />
              </svg>
            </div>
          )}

          {/* Callout Leader-Line Buttons Bar (accessible real <button> elements with visible focus ring) */}
          <div
            aria-label="Numbered assembly callouts"
            className="border-t-2 border-[#0f2547] bg-[#f6f3ec] p-3 sm:p-4"
          >
            <div className="mb-2 flex items-center justify-between font-mono text-xs text-[#1e3a6d]">
              <span>ASSEMBLY CALLOUT SCHEDULE (CLICK, ENTER, OR SPACE TO INSPECT RULE)</span>
              <span>ESC CLOSES DETAIL</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {model.assemblies.map((asm) => {
                const isSelected = selectedId === asm.id
                return (
                  <button
                    key={asm.id}
                    type="button"
                    data-testid={`callout-${asm.partNumber}`}
                    data-assembly-id={asm.id}
                    aria-expanded={isSelected}
                    aria-controls="blueprint-detail-panel"
                    onClick={() => handleSelectCallout(asm.id)}
                    className={`group flex w-full items-start gap-2.5 border border-[#0f2547] p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[#0f2547] focus-visible:ring-offset-2 focus-visible:outline-none ${
                      isSelected
                        ? "bg-[#0f2547] text-[#f6f3ec]"
                        : "bg-[#f6f3ec] text-[#0f2547] hover:bg-[#ede8dd]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 border px-1.5 py-0.5 font-mono text-xs font-bold ${
                        isSelected
                          ? "border-[#f6f3ec] bg-[#1e3a6d] text-[#f6f3ec]"
                          : "border-[#0f2547] bg-[#ede8dd] text-[#0f2547]"
                      }`}
                    >
                      {asm.partNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-mono text-xs font-bold">
                        <span>{asm.titleEn}</span>
                      </span>
                      <span
                        lang="th"
                        className={`mt-0.5 block text-xs ${
                          isSelected ? "text-[#ede8dd]" : "text-[#1e3a6d]"
                        }`}
                      >
                        {asm.lineTh}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
                        {asm.metrics.map((m) => (
                          <span key={m.label}>
                            {m.label}: <strong>{m.value}</strong>
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Active Assembly Detail Panel + Document Token Conduit Schedule */}
        <div className="flex flex-col justify-between bg-[#f6f3ec] p-3 sm:p-5 lg:col-span-4">
          <div id="blueprint-detail-panel" data-testid="blueprint-detail-panel">
            {selectedAssembly ? (
              <section
                aria-label={`${selectedAssembly.titleEn} specification`}
                className="border-2 border-[#0f2547] bg-[#ede8dd] p-3.5"
              >
                <div className="flex items-start justify-between gap-2 border-b border-[#0f2547] pb-2">
                  <div>
                    <p className="font-mono text-xs font-bold uppercase text-[#1e3a6d]">
                      PART NO. {selectedAssembly.partNumber} · SPECIFICATION
                    </p>
                    <h2
                      data-testid="detail-title"
                      className="text-base font-bold text-[#0f2547]"
                    >
                      {selectedAssembly.titleEn}
                    </h2>
                    <p className="text-xs text-[#1e3a6d]" lang="th">
                      {selectedAssembly.lineTh}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="detail-close"
                    onClick={handleCloseDetail}
                    className="border border-[#0f2547] bg-[#f6f3ec] px-2 py-1 font-mono text-xs font-semibold text-[#0f2547] hover:bg-[#0f2547] hover:text-[#f6f3ec] focus-visible:ring-2 focus-visible:ring-[#0f2547] focus-visible:outline-none"
                  >
                    CLOSE [ESC]
                  </button>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 border-b border-[#0f2547]/40 pb-3 font-mono text-xs">
                  {selectedAssembly.metrics.map((m) => (
                    <div
                      key={m.label}
                      className="border border-[#0f2547]/50 bg-[#f6f3ec] p-2"
                    >
                      <dt className="text-[10px] uppercase text-[#1e3a6d]">
                        {m.label}
                      </dt>
                      <dd className="mt-0.5 text-sm font-bold text-[#0f2547]">
                        {m.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 space-y-2 text-xs leading-relaxed">
                  <div className="font-mono text-[11px] font-bold uppercase text-[#1e3a6d]">
                    VERIFIED CODE RULE
                  </div>
                  <p data-testid="detail-rule-en" className="text-[#0f2547]">
                    {selectedAssembly.codeRuleEn}
                  </p>
                  <p
                    data-testid="detail-rule-th"
                    lang="th"
                    className="text-[#1e3a6d]"
                  >
                    {selectedAssembly.codeRuleTh}
                  </p>
                </div>

                <div className="mt-3 border-t border-[#0f2547]/40 pt-2.5 font-mono text-[11px]">
                  <span className="font-bold text-[#1e3a6d]">SOURCE MODULES: </span>
                  <span>{selectedAssembly.codeRefs.join(", ")}</span>
                </div>
              </section>
            ) : (
              <section
                aria-label="No assembly selected"
                className="border border-dashed border-[#0f2547] p-4 font-mono text-xs text-[#1e3a6d]"
              >
                Select any numbered callout (01-08) to inspect its database and server-action rule.
              </section>
            )}

            {/* Animated Document Token Flow Schedule */}
            <section
              aria-label="Document token path"
              className="mt-4 border border-[#0f2547] bg-[#f6f3ec] p-3.5"
            >
              <div className="border-b border-[#0f2547]/40 pb-2">
                <p className="font-mono text-[11px] font-bold uppercase text-[#1e3a6d]">
                  DOCUMENT TOKEN CONDUIT
                </p>
                <p className="text-xs text-[#0f2547]">
                  Quote -&gt; Project -&gt; Invoice -&gt; Claim -&gt; Verification -&gt; Allocation
                </p>
                <p className="text-xs text-[#1e3a6d]" lang="th">
                  การเดินทางของเอกสารตั้งแต่วงจรใบเสนอราคาจนถึงการตรวจหลักฐานและตัดยอดชำระเงิน
                </p>
              </div>
              <ol className="mt-2.5 space-y-1.5 font-mono text-xs">
                {model.tokenPath.map((wp, idx) => {
                  const active = !reducedMotion && idx === tokenStepIndex
                  return (
                    <li
                      key={wp.step}
                      data-testid={`token-step-${wp.step}`}
                      className={`flex items-center justify-between border px-2.5 py-1.5 ${
                        active
                          ? "border-[#b44c1c] bg-[#ede8dd] font-bold text-[#0f2547]"
                          : "border-[#0f2547]/40 text-[#0f2547]"
                      }`}
                    >
                      <span>{wp.labelEn}</span>
                      <span lang="th" className="text-[11px] text-[#1e3a6d]">
                        {wp.labelTh}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>
          </div>

          {/* Engineering Title Block Footer */}
          <footer className="mt-4 border-t-2 border-[#0f2547] pt-3 font-mono text-[11px] text-[#1e3a6d]">
            <div className="flex flex-wrap justify-between gap-2">
              <span>SCALE: {model.titleBlock.scale}</span>
              <span>UNIT: SATANG BIGINT (100 = 1 THB)</span>
            </div>
            <p className="mt-1">
              Operational layer for service workflows; Postgres Row Level Security on every tenant table.
            </p>
          </footer>
        </div>
      </div>
    </div>
  )
}
