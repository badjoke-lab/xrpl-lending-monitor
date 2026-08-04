import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const wrapper = read(
  'scripts/verify-supabase-r5-recovery-burst-adoption-aware.mjs',
)
const workflow = read('.github/workflows/r5-bounded-recovery-burst.yml')

describe('R5 adoption-aware bounded recovery burst contract', () => {
  it('keeps the original bounded verifier as the ordinary execution path', () => {
    for (const required of [
      "const legacyVerifier = 'scripts/verify-supabase-r5-recovery-burst.mjs'",
      'runLegacyVerifier(requestedBatchLimit, requestedWallSeconds)',
      'if (first.code === 0) return',
      'R5_RECOVERY_BURST_BATCH_LIMIT: String(batchLimit)',
      'R5_RECOVERY_BURST_WALL_SECONDS: String(wallSeconds)',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('opens the bridge only for the exact observed non-atomic adoption symptom', () => {
    for (const required of [
      "const nonAtomicMessage = 'R5 recovery changed non-atomically while awaiting batch'",
      'if (!firstOutput.includes(nonAtomicMessage))',
      'legacy R5 burst verifier failed outside the adoption bridge',
      'afterAdoptions.adoptionCount !== beforeAdoptions.adoptionCount + 1',
      'R5 non-atomic observation did not add exactly one adoption record',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('binds adoption records to exact canonical batch and hash continuity', () => {
    for (const required of [
      "'r5-active-descendant-adoption-summary'",
      'adoption.firstBatchSequence !== before.completedBatches + 1',
      'adoption.startLedgerIndex !== before.currentWatermark.ledgerIndex + 1',
      'adoption.expectedParentHash !== before.currentWatermark.ledgerHash',
      'batch.startLedgerIndex !== expectedLedgerIndex',
      'batch.expectedParentHash !== expectedParentHash',
      "origin: adopted ? 'adopted_active_descendant' : 'r5_executor'",
      'adopted && batch.finalizedEgressUpperBoundBytes !== 0',
      'after.lastAccountingDigest !== lastBatch?.accountingDigest',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('allows only adoption batches plus at most one executor batch per trigger', () => {
    for (const required of [
      'const executorBatchCount = advancedBatches - adoption.adoptedBatchCount',
      '![0, 1].includes(executorBatchCount)',
      'advancedBatches > requestedBatchLimit',
      'R5 adoption bridge exceeded the finite per-trigger batch bound',
      'const remainingBatchLimit = requestedBatchLimit - bridge.advancedBatches',
      'bridge.batches.length + continuationBatches.length <= requestedBatchLimit',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('retains exact final active boundary and closed release gates', () => {
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
      expect(wrapper).toContain(required)
    }
  })

  it('runs the adoption-aware verifier from the owner-gated finite workflow', () => {
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
