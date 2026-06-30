import { sumSatang, type Satang } from "@/lib/money"
import type { Enums } from "@/lib/types/database"

export type DealStage = Enums<"deal_stage">
export type DealLike = { stage: DealStage; value_satang: number }

/** Stages considered "open" pipeline (not yet won or lost). */
export const OPEN_STAGES: readonly DealStage[] = [
  "lead",
  "contacted",
  "discovery",
  "proposal",
  "negotiation",
]

/** Default win-probability per stage, used for weighted pipeline. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  lead: 0.1,
  contacted: 0.2,
  discovery: 0.3,
  proposal: 0.5,
  negotiation: 0.7,
  won: 1,
  lost: 0,
}

export function isOpenStage(stage: DealStage): boolean {
  return OPEN_STAGES.includes(stage)
}

/** Total value of all open deals (unweighted). */
export function pipelineValue(deals: DealLike[]): Satang {
  return sumSatang(deals.filter((d) => isOpenStage(d.stage)).map((d) => d.value_satang))
}

/** Probability-weighted value of open deals. */
export function weightedPipelineValue(deals: DealLike[]): Satang {
  const total = deals
    .filter((d) => isOpenStage(d.stage))
    .reduce((acc, d) => acc + d.value_satang * STAGE_PROBABILITY[d.stage], 0)
  return Math.round(total)
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
