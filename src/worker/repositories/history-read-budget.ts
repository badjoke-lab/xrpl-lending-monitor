const DEFAULT_SEGMENT_READS = 4
const DEFAULT_WALL_TIME_MS = 1_000
const WALL_TIME_PER_SEGMENT_MS = 300

export interface AdaptiveHistoryReadBudget {
  maxSegmentReads: number
  maxWallTimeMs: number
}

export function adaptiveHistoryReadBudget(
  orderedRecordCounts: readonly number[],
  limit: number,
  filtered: boolean,
): AdaptiveHistoryReadBudget {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive safe integer')
  if (orderedRecordCounts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('record counts must be non-negative safe integers')
  }

  const nonzero = orderedRecordCounts.filter((count) => count > 0)
  let requiredReads = nonzero.length

  if (!filtered) {
    let publishedRecords = 0
    requiredReads = 0
    for (const count of nonzero) {
      requiredReads += 1
      publishedRecords += count
      if (publishedRecords >= limit) break
    }
  }

  const maxSegmentReads = Math.max(DEFAULT_SEGMENT_READS, requiredReads)
  return {
    maxSegmentReads,
    maxWallTimeMs: Math.max(DEFAULT_WALL_TIME_MS, maxSegmentReads * WALL_TIME_PER_SEGMENT_MS),
  }
}
