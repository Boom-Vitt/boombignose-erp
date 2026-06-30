import { describe, it, expect } from "vitest"

import {
  pipelineValue,
  weightedPipelineValue,
  wonValue,
  pipelineByStage,
  isOpenStage,
  type DealLike,
} from "@/lib/metrics/pipeline"

const deals: DealLike[] = [
  { stage: "lead", value_satang: 100_000 },
  { stage: "proposal", value_satang: 200_000 },
  { stage: "negotiation", value_satang: 300_000 },
  { stage: "won", value_satang: 500_000 },
  { stage: "lost", value_satang: 400_000 },
]

describe("pipeline metrics", () => {
  it("pipelineValue sums open deals only", () => {
    expect(pipelineValue(deals)).toBe(600_000)
  })

  it("weightedPipelineValue applies stage probabilities", () => {
    // 0.1*100000 + 0.5*200000 + 0.7*300000 = 320000
    expect(weightedPipelineValue(deals)).toBe(320_000)
  })

  it("wonValue sums won deals", () => {
    expect(wonValue(deals)).toBe(500_000)
  })

  it("pipelineByStage groups values across all stages", () => {
    const g = pipelineByStage(deals)
    expect(g.lead).toBe(100_000)
    expect(g.proposal).toBe(200_000)
    expect(g.won).toBe(500_000)
    expect(g.lost).toBe(400_000)
    expect(g.discovery).toBe(0)
  })

  it("isOpenStage classifies stages", () => {
    expect(isOpenStage("lead")).toBe(true)
    expect(isOpenStage("negotiation")).toBe(true)
    expect(isOpenStage("won")).toBe(false)
    expect(isOpenStage("lost")).toBe(false)
  })
})
