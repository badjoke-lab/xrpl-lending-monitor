import { describe, expect, it } from 'vitest'

import { fastLaneQueueFailureDisposition } from './fast-lane-queue-failure'
import { FastLaneStorageCapacityError } from './repositories/fast-lane-storage-retention'

describe('fast-lane Queue failure disposition', () => {
  it('acks explicit capacity guard failures', () => {
    expect(fastLaneQueueFailureDisposition(
      new FastLaneStorageCapacityError(
        'database_size',
        'physical database capacity guard reached',
      ),
    )).toBe('ack')
  })

  it('acks Cloudflare D1 maximum-size failures', () => {
    expect(fastLaneQueueFailureDisposition(
      new Error('D1_ERROR: Exceeded maximum DB size'),
    )).toBe('ack')
  })

  it('retries ordinary transient failures', () => {
    expect(fastLaneQueueFailureDisposition(
      new Error('XRPL endpoint temporarily unavailable'),
    )).toBe('retry')
  })
})
