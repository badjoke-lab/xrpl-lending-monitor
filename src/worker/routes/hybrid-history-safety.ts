import type { HybridHistoryResult } from '../repositories/hybrid-history-repository'

export function safeHybridResult<T>(result: HybridHistoryResult<T>, limit: number): boolean {
  return result.immutable.complete || result.merge.immutableInput >= limit
}

export function safeNewestFirstHybridResult<T>(result: HybridHistoryResult<T>, limit: number): boolean {
  return safeHybridResult(result, limit) || result.items.length >= limit
}
