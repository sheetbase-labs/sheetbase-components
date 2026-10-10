import { describe, expect, it } from 'vitest'
import { MIN_CHART_HEIGHT, stageChartHeight } from './chart-size'

describe('stageChartHeight', () => {
  it('fills the stage content box exactly', () => {
    expect(stageChartHeight(510, 4, 6)).toBe(500)
    expect(stageChartHeight(900)).toBe(900)
    expect(stageChartHeight(400.7, 4, 6)).toBe(390)
  })

  it('tracks short and tall stages instead of a fixed default', () => {
    expect(stageChartHeight(180, 4, 6)).toBe(170)
    expect(stageChartHeight(1400, 4, 6)).toBe(1390)
  })

  it('floors degenerate stages and ignores unparseable padding', () => {
    expect(stageChartHeight(40, 4, 6)).toBe(MIN_CHART_HEIGHT)
    expect(stageChartHeight(300, Number.NaN, Number.NaN)).toBe(300)
  })
})
