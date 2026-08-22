import Link from "next/link"
import { ArrowUpRight, Check, ShieldCheck, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

type AuthFrameProps = {
  children: React.ReactNode
  eyebrow?: string
  title: string
  description: string
  className?: string
}

export function AnyErpMark({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label="ANY ERP home">
      <span
        className={cn(
          "grid size-9 place-items-center rounded-xl text-sm font-black tracking-[-0.16em] shadow-sm",
          dark ? "bg-white text-slate-950" : "bg-slate-950 text-white"
        )}
      >
        A
      </span>
      <span className={cn("text-sm font-semibold tracking-[0.2em]", dark ? "text-white" : "text-slate-950")}>
        ANY ERP
      </span>
    </Link>
  )
}

export function AuthFrame({ children, eyebrow = "ANY ERP ACCESS", title, description, className }: AuthFrameProps) {
  return (
    <main className="min-h-svh bg-[#f5f7fb] text-slate-950 lg:grid lg:grid-cols-[minmax(0,1.06fr)_minmax(480px,0.94fr)]">
      <section className="relative hidden overflow-hidden bg-slate-950 px-10 py-10 text-white lg:flex lg:flex-col xl:px-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(34,211,238,0.24),transparent_27%),radial-gradient(circle_at_16%_82%,rgba(99,102,241,0.29),transparent_32%)]" />
        <div className="relative flex items-center justify-between">
          <AnyErpMark dark />
          <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-medium tracking-wide text-slate-300">Business, in view</span>
        </div>
        <div className="relative my-auto max-w-xl py-20">
          <p className="mb-5 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-cyan-200"><Sparkles className="size-3.5" /> CLARITY FOR THE WHOLE BUSINESS</p>
          <h1 className="max-w-lg text-5xl leading-[1.02] font-semibold tracking-[-0.055em] xl:text-6xl">Run the day.<br />See the whole picture.</h1>
          <p className="mt-7 max-w-md text-base leading-7 text-slate-300">Keep relationships, revenue, delivery, and cash in one calm operational system.</p>
          <div className="mt-12 grid max-w-lg grid-cols-2 gap-3">
            {[["Pipeline", "Every deal, in motion"], ["Delivery", "Work that ships"], ["Finance", "Cash with context"], ["Automation", "Follow-ups handled"]].map(([label, detail]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                <div className="mb-2 flex items-center justify-between text-sm font-medium">{label}<ArrowUpRight className="size-3.5 text-cyan-200" /></div>
                <p className="text-xs text-slate-400">{detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="size-4 text-emerald-300" />Private by design. Your organization stays scoped to you.</div>
      </section>
      <section className="flex min-h-svh items-center justify-center px-5 py-8 sm:px-8 lg:px-12 xl:px-20">
        <div className={cn("w-full max-w-[26rem]", className)}>
          <div className="mb-14 lg:hidden"><AnyErpMark /></div>
          <div className="mb-8">
            <p className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-indigo-600">{eyebrow}</p>
            <h2 className="text-3xl font-semibold tracking-[-0.045em] text-slate-950">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
          </div>
          {children}
          <p className="mt-9 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400"><Check className="size-3.5 text-emerald-500" />Secure account access powered by Supabase</p>
        </div>
      </section>
    </main>
  )
}
