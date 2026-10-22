import { sumSatang, type Satang } from "@/lib/money"
import type { Enums } from "@/lib/types/database"

export type DealStage = Enums<"deal_stage">
export type DealLike = { stage: DealStage; value_satang: number; probability: number }

/** Stages considered "open" pipeline (not yet won or lost). */
export const OPEN_STAGES: readonly DealStage[] = [
  "lead",
  "contacted",
  "discovery",
  "proposal",
  "negotiation",
]

/**
 * Default win probability (whole percent) a deal takes when it enters a stage. Mirrors
 * private.deal_stage_probability in the CRM migration, which applies it on every write.
 */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  lead: 10,
  contacted: 20,
  discovery: 30,
  proposal: 50,
  negotiation: 70,
  won: 100,
  lost: 0,
}

export function isOpenStage(stage: DealStage): boolean {
  return OPEN_STAGES.includes(stage)
}

/** Total value of all open deals (unweighted). */
export function pipelineValue(deals: DealLike[]): Satang {
  return sumSatang(deals.filter((d) => isOpenStage(d.stage)).map((d) => d.value_satang))
}

/** Expected revenue: value x the deal's win probability, rounded half up per deal so sums stay exact. */
export function expectedRevenue(d: Pick<DealLike, "value_satang" | "probability">): Satang {
  // Integer math: value x probability passes 2^53 for large deals, where a float product loses satang.
  return Number((BigInt(d.value_satang) * BigInt(d.probability) + BigInt(50)) / BigInt(100))
}

/** Expected revenue of open deals. */
export function weightedPipelineValue(deals: DealLike[]): Satang {
  return sumSatang(deals.filter((d) => isOpenStage(d.stage)).map(expectedRevenue))
}

/** Total value of won deals. */
export function wonValue(deals: DealLike[]): Satang {
  return sumSatang(deals.filter((d) => d.stage === "won").map((d) => d.value_satang))
}

/** Value grouped by stage (every stage present, 0 when empty). */
export function pipelineByStage(deals: DealLike[]): Record<DealStage, Satang> {
  const totals: Record<DealStage, Satang> = {
    lead: 0,
    contacted: 0,
    discovery: 0,
    proposal: 0,
    negotiation: 0,
    won: 0,
    lost: 0,
  }
  for (const d of deals) totals[d.stage] += d.value_satang
  return totals
}
