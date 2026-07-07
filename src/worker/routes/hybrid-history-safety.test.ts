import { describe, expect, it } from 'vitest'

import type { HybridHistoryResult } from '../repositories/hybrid-history-repository'
import { safeHybridResult, safeNewestFirstHybridResult } from './hybrid-history-safety'

function result(options: {
  complete?: boolean
  immutableInput?: number
  liveAccepted?: number
  itemCount?: number
} = {}): HybridHistoryResult<number> {
  return {
    items: Array.from({ length: options.itemCount ?? 0 }, (_, index) => index),
    immutable: {
      complete: options.complete ?? false,
      nextCursor: 'cursor',
      segmentReads: 4,
      compressedBytes: 0,
      decompressedBytes: 0,
      recordsExamined: 10_000,
    },
    merge: {
      immutableInput: options.immutableInput ?? 0,
      liveInput: options.liveAccepted ?? 0,
      immutableAccepted: options.immutableInput ?? 0,
      liveAccepted: options.liveAccepted ?? 0,
      liveSuppressedAtBoundary: 0,
      duplicatesSuppressed: 0,
    },
  }
}

describe('hybrid history safety', () => {
  it('keeps the base rule strict when immutable history is incomplete', () => {
    expect(safeHybridResult(result({ liveAccepted: 100, itemCount: 100 }), 100)).toBe(false)
    expect(safeHybridResult(result({ immutableInput: 100, itemCount: 100 }), 100)).toBe(true)
    expect(safeHybridResult(result({ complete: true }), 100)).toBe(true)
  })

  it('allows newest-first pages when the merged page fills the requested limit', () => {
    expect(safeNewestFirstHybridResult(result({ liveAccepted: 100, itemCount: 100 }), 100)).toBe(true)
    expect(safeNewestFirstHybridResult(result({ immutableInput: 40, liveAccepted: 60, itemCount: 100 }), 100)).toBe(true)
    expect(safeNewestFirstHybridResult(result({ immutableInput: 40, liveAccepted: 59, itemCount: 99 }), 100)).toBe(false)
  })
})
