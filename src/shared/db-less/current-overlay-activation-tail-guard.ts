/**
 * Production D4 activation guard; deterministic, read-only and fail-closed.
 *
 * The source D3 channel used for checkpoint compaction is intentionally pinned
 * at build start, but D3 continues its five-minute cadence while 257 Release
 * assets are uploaded. Check its LATEST indexed Current coverage immediately
 * before the D4 channel pointer is published, not only at prepare time.
 */
import type { DbLessChannelV1 } from './channel'
import type { DbLessCurrentOverlayCheckpointManifest } from './current-overlay-checkpoint'

export interface DbLessD4ActivationTailSafetyV1 {
  schemaVersion: 1
  checkpointThroughLedger: number
  currentD3Ledger: number
  coveredFromLedger: number
  tailGenerations: number
  generationsAfterCheckpoint: number
  remainingTailSlots: number
  pass: true
}

export function assertDbLessD4ActivationTailSafety(options: {
  checkpoint: DbLessCurrentOverlayCheckpointManifest
  currentD3: DbLessChannelV1
  /** Reserve room for the D3 writer to move between this check and channel CAS. */
  minRemainingTailSlots?: number
}): DbLessD4ActivationTailSafetyV1 {
  const { checkpoint, currentD3 } = options
  const minRemainingTailSlots = options.minRemainingTailSlots ?? 8
  if (!Number.isSafeInteger(minRemainingTailSlots)
    || minRemainingTailSlots < 0 || minRemainingTailSlots > 128) {
    throw new Error('D4 activation Current tail safety margin is invalid')
  }
  if (checkpoint.network !== 'devnet' || currentD3.network !== 'devnet'
    || checkpoint.epochId !== currentD3.epochId
    || checkpoint.baseIdentity !== currentD3.base.generationId
    || checkpoint.throughLedgerIndex > currentD3.lastCommittedLedgerIndex) {
    throw new Error('D4 activation source epoch/base/head identity differs from current D3')
  }

  const tail = currentD3.currentProjectionTail
  if (!tail || tail.schemaVersion !== 1
    || tail.coverageStartLedgerIndex > checkpoint.throughLedgerIndex
    || tail.generations.length > 128) {
    throw new Error('D4 activation would expose a Current tail gap')
  }
  if (checkpoint.throughLedgerIndex === tail.coverageStartLedgerIndex
    && checkpoint.throughLedgerHash !== tail.coverageStartLedgerHash) {
    throw new Error('D4 activation checkpoint hash differs from current tail coverage boundary')
  }
  if (checkpoint.throughLedgerIndex === currentD3.lastCommittedLedgerIndex
    && checkpoint.throughLedgerHash !== currentD3.lastCommittedLedgerHash) {
    throw new Error('D4 activation checkpoint hash differs from D3 head')
  }
  const indexedBoundary = tail.generations.find(
    pointer => pointer.endLedgerIndex === checkpoint.throughLedgerIndex,
  )
  if (indexedBoundary && indexedBoundary.endLedgerHash !== checkpoint.throughLedgerHash) {
    throw new Error('D4 activation checkpoint hash differs from retained indexed generation')
  }

  const selected = tail.generations.filter(
    pointer => pointer.endLedgerIndex > checkpoint.throughLedgerIndex,
  )
  if (selected.some(pointer => pointer.startLedgerIndex <= checkpoint.throughLedgerIndex)) {
    throw new Error('D4 activation checkpoint bisects indexed D3 Current generation')
  }
  // A directly succeeding generation binds to the checkpoint's own ledger
  // hash. Gaps in the mutation-only index are allowed: no mutation occurred
  // during those intervening ledger ranges.
  if (selected[0]?.previousLedgerIndex === checkpoint.throughLedgerIndex
    && selected[0].expectedParentHash !== checkpoint.throughLedgerHash) {
    throw new Error('D4 activation D3 successor ledger parent hash differs')
  }
  const remainingTailSlots = 128 - selected.length
  if (remainingTailSlots < minRemainingTailSlots) {
    throw new Error('D4 activation indexed Current tail is too close to eviction')
  }
  return {
    schemaVersion: 1,
    checkpointThroughLedger: checkpoint.throughLedgerIndex,
    currentD3Ledger: currentD3.lastCommittedLedgerIndex,
    coveredFromLedger: tail.coverageStartLedgerIndex,
    tailGenerations: tail.generations.length,
    generationsAfterCheckpoint: selected.length,
    remainingTailSlots,
    pass: true,
  }
}
