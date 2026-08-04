import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const verifier = read('scripts/verify-supabase-r5-recovery-burst.mjs')

describe('R5 bounded recovery burst contract', () => {
  it('requires a previously verified first batch', () => {
    for (const required of [
      'before.completedBatches < 1',
      'before.committedLedgers < 1',
      'R5 first recovery batch must be verified before burst execution',
      'firstBatchPreviouslyVerified: before.completedBatches >= 1',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('caps batch and wall-clock scope', () => {
    for (const required of [
      "boundedIntegerEnvironment('R5_RECOVERY_BURST_BATCH_LIMIT', 8, 1, 64)",
      "boundedIntegerEnvironment('R5_RECOVERY_BURST_WALL_SECONDS', 900, 60, 1800)",
      'for (let ordinal = 0; ordinal < batchLimit; ordinal += 1)',
      "stopReason = 'batch_limit'",
      "reason: 'wall_clock_limit'",
      'boundedBatchLimit: batchLimit <= 64',
      'boundedWallClock: wallSeconds <= 1800',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('uses deterministic sequential batch identities', () => {
    for (const required of [
      'const sequence = before.completedBatches + 1',
      'String(sequence).padStart(8, \'0\')',
      'return `r5-batch-v1-${recoveryRunId}-${String(sequence).padStart(8, \'0\')}`',
      'batch.batchSequence !== sequence',
      'batch.batchId !== expectedBatchId',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('bounds retries and re-reads durable state after every invocation', () => {
    for (const required of [
      'const maximumAttemptsPerBatch = 3',
      'const retryDelayMilliseconds = 60_000',
      'for (let attempt = 1; attempt <= maximumAttemptsPerBatch; attempt += 1)',
      'const after = await readRecovery()',
      'const batch = verifyCompletedBatch(await readBatch(sequence), sequence, before, after)',
      'R5 recovery changed non-atomically while awaiting batch',
      'await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds))',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('accepts only atomic one-to-twenty-four-ledger advances', () => {
    for (const required of [
      'ledgerCount !== endLedgerIndex - startLedgerIndex + 1',
      'ledgerCount < 1',
      'ledgerCount > 24',
      'startLedgerIndex !== before.currentWatermark.ledgerIndex + 1',
      'endLedgerIndex !== after.currentWatermark.ledgerIndex',
      'batch.expectedParentHash !== before.currentWatermark.ledgerHash',
      'batch.finalLedgerHash !== after.currentWatermark.ledgerHash',
      'batch.finalWorkId !== after.currentWatermark.workId',
      'after.completedBatches !== before.completedBatches + 1',
      'after.committedLedgers !== before.committedLedgers + ledgerCount',
      'after.lastAccountingDigest !== batch.accountingDigest',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('retains revision-three resource bounds', () => {
    for (const required of [
      'batch.reservedEgressUpperBoundBytes !== 134217728',
      'finalizedEgressUpperBoundBytes >= 33554432',
      'finalizedEgressUpperBoundBytes >= batch.reservedEgressUpperBoundBytes',
      'combinedProxyBytesWithinFixedReserve',
      'twoInvocationReservationUsed',
      'serviceKeyNotReturned',
      'fixedFunctionResponseReserveBytes',
      '!== 131072',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('stops only at explicit bounded or terminal-safe boundaries', () => {
    for (const required of [
      "'recovery_already_caught_up'",
      "'caught_up_at_claim_boundary'",
      "'fresh_head_refresh_required'",
      "'wall_clock_limit'",
      "stopReason = 'batch_limit'",
      'R5 recovery burst made no progress',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('verifies a quiescent active boundary after the burst', () => {
    for (const required of [
      "requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1",
      "requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0",
      "requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0",
      "requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0",
      'boundaryWatermark.ledgerIndex !== after.currentWatermark.ledgerIndex',
      'boundaryWatermark.ledgerHash !== after.currentWatermark.ledgerHash',
      'boundaryWatermark.workId !== after.currentWatermark.workId',
      'exactBatchAdvance: advancedBatches === batches.length',
      'exactLedgerAdvance: advancedLedgers === summedLedgers',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('keeps later R5 gates closed and writes sanitized evidence', () => {
    for (const required of [
      "purpose: 'r5-supabase-active-recovery-burst-verification'",
      'verified-r5-recovery-burst.json',
      'failed-r5-recovery-burst-verification.json',
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(verifier).not.toContain('SUPABASE_DB_PASSWORD')
  })
})
