import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const verifier = read(
  'scripts/verify-supabase-r5-first-recovery-batch-strict.mjs',
)

describe('R5 first-batch progressive verifier contract', () => {
  it('keeps batch one immutable while allowing later recovery progress', () => {
    for (const required of [
      "const firstBatchId =\n  'r5-batch-v1-r5-recovery-selected-revision3-entry-00000001'",
      'batch.batchSequence !== 1',
      'endLedgerIndex !== startLedgerIndex + 23',
      'ledgerCount !== 24',
      'batch.expectedParentHash !== startWatermark.ledgerHash',
      'const exactFirstBatchOnly = after.completedBatches === 1',
      'after.lastAccountingDigest !== batch.accountingDigest',
      'after.completedBatches > 1',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('proves any physical active lead as a complete one-ledger hash chain', () => {
    for (const required of [
      'with physical as (',
      'descendant_chain as (',
      'row_number() over (order by work.start_ledger_index, work.work_id)',
      'work.start_ledger_index > $3::bigint',
      'work.scanned_end_ledger_index <= physical.ledger_index',
      'start_ledger_index = previous_ledger_index + 1',
      'expected_parent_hash = $4::text',
      'expected_parent_hash = prior_final_ledger_hash',
      'workCount !== expectedCount',
      'physical active descendant chain is not one-ledger hash-linked',
      'physical active descendant endpoints do not match R5 and active boundaries',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('requires quiescent scheduler state and intact first-batch rows', () => {
    for (const required of [
      'boundary.pendingCount',
      'boundary.leasedCount',
      'boundary.retryCount',
      'boundary.inflightWorkCount',
      'boundary.firstBatchCommittedWorkCount',
      'boundary.firstBatchReferenceRowCount',
      'onePendingScanAfterCommit',
      'noLeasedOrRetryMessagesAfterCommit',
      'noInflightWorkAfterCommit',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('does not adopt, rewrite, or delete active data', () => {
    for (const forbidden of [
      'xrpl_adopt_r5_committed_active_descendants',
      'update public.xrpl_phase',
      'delete from',
      'truncate ',
      'drop table',
    ]) {
      expect(verifier.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    expect(verifier).toContain('physicalDescendantChainProved')
    expect(verifier).toContain('unadoptedPhysicalDescendantLedgers')
  })
})
