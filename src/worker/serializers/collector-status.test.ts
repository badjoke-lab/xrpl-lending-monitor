import { describe, expect, it } from 'vitest'
import { serializeCollectorStatus } from './collector-status'

describe('collector status', () => {
  it('returns uninitialized without state', () => {
    const result = serializeCollectorStatus({ collector: null, sync: null, staleAfterSeconds: 30, nowMs: 0 })
    expect(result.status).toBe('uninitialized')
  })
})
