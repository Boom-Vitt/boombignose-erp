import { describe, it, expect } from "vitest"

import {
  pipelineValue,
  weightedPipelineValue,
  wonValue,
  pipelineByStage,
  isOpenStage,
  expectedRevenue,
  STAGE_PROBABILITY,
  type DealLike,
} from "@/lib/metrics/pipeline"

const deals: DealLike[] = [
  { stage: "lead", value_satang: 100_000, probability: 10 },
  { stage: "proposal", value_satang: 200_000, probability: 50 },
  { stage: "negotiation", value_satang: 300_000, probability: 70 },
  { stage: "won", value_satang: 500_000, probability: 100 },
  { stage: "lost", value_satang: 400_000, probability: 0 },
]

describe("pipeline metrics", () => {
  it("pipelineValue sums open deals only", () => {
    expect(pipelineValue(deals)).toBe(600_000)
  })

  it("weightedPipelineValue sums the expected revenue of open deals", () => {
    // 0.1*100000 + 0.5*200000 + 0.7*300000 = 320000
    expect(weightedPipelineValue(deals)).toBe(320_000)
  })

  it("uses each deal's own probability, not its stage default", () => {
    const edited: DealLike[] = [{ stage: "proposal", value_satang: 200_000, probability: 90 }]
    expect(weightedPipelineValue(edited)).toBe(180_000)
  })

  it("expectedRevenue rounds value x probability to whole satang", () => {
    expect(expectedRevenue({ value_satang: 333, probability: 50 })).toBe(167)
    expect(expectedRevenue({ value_satang: 1_000_001, probability: 0 })).toBe(0)
    expect(expectedRevenue({ value_satang: 1_000_001, probability: 100 })).toBe(1_000_001)
  })

  it("expectedRevenue stays exact at the largest safe satang value", () => {
    // 9007199254740991 x 30% = 2702159776422297.3
    expect(expectedRevenue({ value_satang: Number.MAX_SAFE_INTEGER, probability: 30 })).toBe(2_702_159_776_422_297)
    expect(expectedRevenue({ value_satang: 5, probability: 50 })).toBe(3)
  })

  it("stage defaults are whole percentages, closed stages pinned to 0 and 100", () => {
    expect(STAGE_PROBABILITY.proposal).toBe(50)
    expect(STAGE_PROBABILITY.won).toBe(100)
    expect(STAGE_PROBABILITY.lost).toBe(0)
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
