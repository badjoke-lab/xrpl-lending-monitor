import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const controller = read(
  'scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs',
)
const workflow = read('.github/workflows/r5-bounded-recovery-burst.yml')

describe('R5 adoption-aware bounded recovery burst contract', () => {
  it('retains the exact finite command, batch and wall-clock bounds', () => {
    for (const required of [
      "boundedIntegerEnvironment('R5_RECOVERY_BURST_BATCH_LIMIT', 8, 1, 64)",
      "boundedIntegerEnvironment('R5_RECOVERY_BURST_WALL_SECONDS', 900, 60, 1800)",
      'maximumAttemptsPerTrigger = 3',
      'retryDelayMilliseconds = 60_000',
      'advancedBatches > remainingLimit',
      'batches.length > batchLimit',
    ]) {
      expect(controller).toContain(required)
    }
  })

  it('verifies every trigger from before state through final state', () => {
    for (const required of [
      'const before = await readRecovery()',
      'const beforeAdoptions = await readAdoptions()',
      'lastTrigger = await invokeTrigger()',
      'const after = await readRecovery()',
      'const afterAdoptions = await readAdoptions()',
      'await verifyCycle(',
      'cycles.push({',
      'everyTriggerAdvanceVerified',
    ]) {
      expect(controller).toContain(required)
    }
  })

  it('permits multiple completed batches only with one exact adoption record', () => {
    for (const required of [
      '![0, 1].includes(addedAdoptions)',
      'afterAdoptions.adoptionCount - beforeAdoptions.adoptionCount',
      'afterAdoptions.adoptedLedgerCount',
      'beforeAdoptions.adoptedLedgerCount + adoption.ledgerCount',
      'adoption.firstBatchSequence !== before.completedBatches + 1',
      'adoption.startLedgerIndex !== before.currentWatermark.ledgerIndex + 1',
      'adoption.expectedParentHash !== before.currentWatermark.ledgerHash',
      '![0, 1].includes(executorBatchCount)',
      'advanced multiple batches without one adoption record',
    ]) {
      expect(controller).toContain(required)
    }
  })

  it('binds every new batch into one contiguous hash-linked range', () => {
    for (const required of [
      'batch.startLedgerIndex !== expectedLedgerIndex',
      'batch.expectedParentHash !== expectedParentHash',
      'expectedLedgerIndex = batch.endLedgerIndex + 1',
      'expectedParentHash = batch.finalLedgerHash',
      "origin: adopted ? 'adopted_active_descendant' : 'r5_executor'",
      'adopted && batch.finalizedEgressUpperBoundBytes !== 0',
      'after.lastAccountingDigest !== lastBatch?.accountingDigest',
    ]) {
      expect(controller).toContain(required)
    }
  })

  it('requires adoption batch rows to match the adoption summary exactly', () => {
    for (const required of [
      'adoptedBatchCount !== Math.ceil(ledgerCount / 24)',
      'const adoptedBatches = batches.slice(0, adoptedBatchCount)',
      'adoptedLedgers !== adoption.ledgerCount',
      'lastAdoptedBatch?.endLedgerIndex !== adoption.endLedgerIndex',
      'lastAdoptedBatch?.finalLedgerHash !== adoption.finalLedgerHash',
      'lastAdoptedBatch?.finalWorkId !== adoption.finalWorkId',
    ]) {
      expect(controller).toContain(required)
    }
  })

  it('retains final active-boundary and release-closure checks', () => {
    for (const required of [
      "requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1",
      "requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0",
      "requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0",
      "requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0",
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
    ]) {
      expect(controller).toContain(required)
    }
  })

  it('runs only from the existing owner-gated finite workflow', () => {
    expect(workflow).toContain(
      'node scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs',
    )
    expect(workflow).toContain("github.actor == 'badjoke-lab'")
    expect(workflow).toContain(
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    )
    expect(workflow).toContain('test "$R5_RECOVERY_BURST_BATCH_LIMIT" -le 64')
    expect(workflow).toContain('test "$R5_RECOVERY_BURST_WALL_SECONDS" -le 1800')
  })
})
