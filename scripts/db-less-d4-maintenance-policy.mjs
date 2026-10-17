/**
 * Read-only D4 maintenance pressure signal.
 * D3 keeps a bounded, moving 128-generation Current index. Waiting for manual
 * attention until that window has already passed D4 is a deployment failure.
 *
 * This does NOT assume that omitted index entries are destroyed: older Release
 * chain links can still exist. We must not call a coverage gap data loss.
 *
 * No mutable API, no network dependency; invokes no job or release publisher.
 */
const POSITIVE = (x) => Number.isSafeInteger(x) && x > 0

export function assessD4Maintenance({ d3, d4, nowMs, dueAt = 48, urgentAt = 80 }) {
  if (!Number.isFinite(nowMs) || nowMs < 0
    || !Number.isSafeInteger(dueAt) || dueAt < 1
    || !Number.isSafeInteger(urgentAt) || urgentAt <= dueAt || urgentAt > 128) {
    throw new Error('D4 guard clock or safety thresholds invalid')
  }
  if (d3?.schemaVersion !== 1 || d4?.schemaVersion !== 1
    || d3.network !== 'devnet' || d4.network !== 'devnet'
    || !d3.epochId || d3.epochId !== d4.epochId
    || !d3.base?.generationId || d3.base.generationId !== d4.active?.baseIdentity) {
    throw new Error('D4 guard D3/D4 epoch, base or network mismatch')
  }
  const head = d3.lastCommittedLedgerIndex
  const checkpoint = d4.active.throughLedgerIndex
  const indexedStart = d3.currentProjectionTail?.coverageStartLedgerIndex
  const generations = d3.currentProjectionTail?.generations
  if (!POSITIVE(head) || !POSITIVE(checkpoint) || !POSITIVE(indexedStart)
    || head < checkpoint || indexedStart > head
    || !Array.isArray(generations) || generations.length > 128) {
    throw new Error('D4 guard channel or Current index shape is invalid')
  }
  if (typeof d3.updatedAt !== 'string' || !Number.isFinite(Date.parse(d3.updatedAt))) {
    throw new Error('D4 guard source update time is invalid')
  }
  const ageSeconds = Math.floor((nowMs - Date.parse(d3.updatedAt)) / 1000)
  if (ageSeconds < -60) {
    throw new Error('D4 guard source timestamp is in the future')
  }
  let previousEnd = indexedStart
  for (const gen of generations) {
    if (!POSITIVE(gen.startLedgerIndex) || !POSITIVE(gen.endLedgerIndex)
      || gen.startLedgerIndex <= previousEnd
      || gen.startLedgerIndex > gen.endLedgerIndex || gen.endLedgerIndex > head) {
      throw new Error('D4 guard indexed Current generations overlap or reverse')
    }
    previousEnd = gen.endLedgerIndex
  }
  // The Current index can stop before the D3 head if there was no new
  // Current mutation since the last indexed generation.
  if (checkpoint === indexedStart && d4.active.throughLedgerHash
    !== d3.currentProjectionTail.coverageStartLedgerHash) {
    throw new Error('D4 guard same-ledger boundary hash mismatch')
  }

  const indexedAfterCheckpoint = generations
    .filter(gen => gen.endLedgerIndex > checkpoint).length
  const coverageOk = checkpoint >= indexedStart
  const sourceFresh = ageSeconds <= 900
  const remainingBeforeEviction = coverageOk
    ? Math.max(0, 128 - indexedAfterCheckpoint)
    : 0

  let status
  if (!sourceFresh) status = 'SOURCE_STALE'
  else if (!coverageOk) status = 'COVERAGE_BLOCKED'
  else if (indexedAfterCheckpoint >= urgentAt) status = 'URGENT'
  else if (indexedAfterCheckpoint >= dueAt) status = 'MAINTENANCE_DUE'
  else status = 'HEALTHY'

  return {
    schemaVersion: 1,
    status,
    network: 'devnet',
    d3Head: head,
    d4Through: checkpoint,
    indexedStart,
    indexedGenerations: generations.length,
    newIndexedGenerations: indexedAfterCheckpoint,
    remainingIndexHeadroom: remainingBeforeEviction,
    uncoveredLedgers: Math.max(0, indexedStart - checkpoint),
    checkpointLagLedgers: head - checkpoint,
    sourceAgeSeconds: ageSeconds,
    sourceFresh,
    coverageOk,
    candidateReleaseMutation: false,
    channelMutation: false,
  }
}
