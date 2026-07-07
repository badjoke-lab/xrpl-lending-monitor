import { describe, expect, it } from 'vitest'

import { adaptiveHistoryReadBudget } from './history-read-budget'

describe('adaptive history read budget', () => {
  it('allows all non-empty archive segments when the published total is below the requested limit', () => {
    expect(adaptiveHistoryReadBudget(
      [2, 10, 2, 2, 1, 1, 4, 8, 1, 13, 8, 13, 11, 4, 2, 2, 10],
      100,
      false,
    )).toEqual({ maxSegmentReads: 17, maxWallTimeMs: 5_100 })
  })

  it('stops after enough published balance-history rows can fill an unfiltered page', () => {
    expect(adaptiveHistoryReadBudget(
      [26, 18, 16, 16, 57, 18, 14, 37, 61, 15],
      100,
      false,
    )).toEqual({ maxSegmentReads: 5, maxWallTimeMs: 1_500 })
  })

  it('keeps the default floor for an unfiltered lifecycle page that fills quickly', () => {
    expect(adaptiveHistoryReadBudget(
      [51, 42, 28, 35, 116, 37, 22, 56, 152, 66],
      100,
      false,
    )).toEqual({ maxSegmentReads: 4, maxWallTimeMs: 1_200 })
  })

  it('allows every non-empty segment for filtered reads', () => {
    expect(adaptiveHistoryReadBudget(
      [26, 18, 16, 16, 57, 18, 14, 37, 61, 15],
      100,
      true,
    )).toEqual({ maxSegmentReads: 10, maxWallTimeMs: 3_000 })
  })

  it('rejects invalid limits and record counts', () => {
    expect(() => adaptiveHistoryReadBudget([1], 0, false)).toThrow('limit must be a positive safe integer')
    expect(() => adaptiveHistoryReadBudget([1, -1], 10, false)).toThrow('record counts must be non-negative safe integers')
  })
})
