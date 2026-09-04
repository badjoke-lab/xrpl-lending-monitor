export interface FastLanePromotionStatuses {
  syncState: 'healthy' | 'stale'
  incrementalCollector: 'healthy' | 'behind'
}

export function fastLanePromotionStatuses(lagLedgers: number): FastLanePromotionStatuses {
  if (!Number.isSafeInteger(lagLedgers) || lagLedgers < 0) {
    throw new Error('fast-lane promotion lag must be a non-negative integer')
  }
  return lagLedgers === 0
    ? { syncState: 'healthy', incrementalCollector: 'healthy' }
    : { syncState: 'stale', incrementalCollector: 'behind' }
}
