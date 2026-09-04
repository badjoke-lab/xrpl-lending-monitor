import { describe, expect, it } from 'vitest'
import { fastLanePromotionStatuses } from './fast-lane-promotion-status'

describe('fastLanePromotionStatuses', () => {
  it('uses healthy on both surfaces when caught up', () => {
    expect(fastLanePromotionStatuses(0)).toEqual({
      syncState: 'healthy',
      incrementalCollector: 'healthy',
    })
  })

  it('maps lag to stale for sync_state and behind for incremental collector', () => {
    expect(fastLanePromotionStatuses(1)).toEqual({
      syncState: 'stale',
      incrementalCollector: 'behind',
    })
  })

  it('rejects invalid lag values', () => {
    expect(() => fastLanePromotionStatuses(-1)).toThrow()
  })
})
