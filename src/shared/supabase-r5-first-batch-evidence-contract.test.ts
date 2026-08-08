import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const trigger = read(
  'supabase/functions/xrpl-r5-recovery-batch-trigger/index.ts',
)
const verifier = read(
  'scripts/verify-supabase-r5-first-recovery-batch-strict.mjs',
)
const ready = read('scripts/verify-supabase-r5-recovery-ready.mjs')
const publisher = read(
  'scripts/publish-supabase-r5-first-recovery-batch-run-locator.mjs',
)
const workflow = read(
  'ops/retired/supabase-remote-probe-r4c-r5-workflow.snapshot.yml',
)
const config = read('supabase/config.toml')

describe('R5 first recovery batch evidence workflow', () => {
  it('keeps the service key inside a one-run token-authenticated trigger', () => {
    for (const required of [
      "const PURPOSE = 'r5-first-active-recovery-batch'",
      "const VERIFY_TOKEN_HEADER = 'x-xrpl-r5-token'",
      "env('XRPL_R5_RECOVERY_VERIFY_TOKEN')",
      "body.source !== 'github_actions'",
      "`${env('SUPABASE_URL')}/functions/v1/xrpl-r5-recovery-batch`",
      'apikey: key',
      'authorization: `Bearer ${key}`',
      'serviceKeyNotReturned: true',
    ]) {
      expect(trigger).toContain(required)
    }
    expect(trigger).not.toContain('SUPABASE_SERVICE_ROLE_KEY:')
  })

  it('binds the two Edge invocation proxy to the fixed response reserve', () => {
    for (const required of [
      'const MAX_REQUEST_BYTES = 4 * 1024',
      'const MAX_EXECUTOR_RESPONSE_BYTES = 64 * 1024',
      'const FIXED_FUNCTION_RESPONSE_RESERVE_BYTES = 128 * 1024',
      'combinedProxyBytes:',
      'combinedProxyBytesWithinFixedReserve:',
      'requestBytes + responseBytes',
      '< FIXED_FUNCTION_RESPONSE_RESERVE_BYTES',
      'twoInvocationReservationUsed: true',
    ]) {
      expect(trigger).toContain(required)
    }
  })

  it('executes only deterministic batch sequence one and reuses completed evidence', () => {
    for (const required of [
      "const recoveryRunId = 'r5-recovery-selected-revision3-entry'",
      "'r5-batch-v1-r5-recovery-selected-revision3-entry-00000001'",
      "if (existingBatch.found !== false && existingBatch.status === 'completed')",
      'executedNow: before.completedBatches === 0',
      'functions/v1/xrpl-r5-recovery-batch-trigger',
      "'batch_lease_active'",
      'maximumAttempts = 3',
      'retryDelayMilliseconds = 60_000',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('proves exact 24-ledger active and resource parity after completion', () => {
    for (const required of [
      'endLedgerIndex !== startLedgerIndex + 23',
      'ledgerCount !== 24',
      'batch.expectedParentHash !== startWatermark.ledgerHash',
      'reservedEgressUpperBoundBytes !== 134217728',
      'finalizedEgressUpperBoundBytes >= 33554432',
      'boundary.firstBatchCommittedWorkCount',
      'boundary.firstBatchReferenceRowCount',
      'after.lastAccountingDigest !== batch.accountingDigest',
      'onePendingScanAfterCommit',
      'noLeasedOrRetryMessagesAfterCommit',
      'noInflightWorkAfterCommit',
      "lagZero: after.status === 'caught_up'",
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('makes preparation verification reentrant after recovery starts', () => {
    for (const required of [
      "!['prepared', 'running', 'caught_up'].includes(recovery.status)",
      "checks.activeRecoveryStarted !== (recovery.status === 'running')",
      'committedLedgers !== currentWatermark.ledgerIndex - startWatermark.ledgerIndex',
      'completedBatches * 24 < committedLedgers',
      "if (recovery.status === 'prepared')",
      "recovery.status === 'caught_up'",
      'zeroRecoveryBatchesCommitted: verified.completedBatches === 0',
      "activeRecoveryStarted: verified.recovery.status === 'running'",
      'runLegacyPreparation()',
    ]) {
      expect(ready).toContain(required)
    }
  })

  it('retains historical bundle, deployment, invocation, and publication choreography', () => {
    for (const required of [
      "bundle_function 'supabase/functions/xrpl-r5-recovery-batch/index.ts'",
      "bundle_function 'supabase/functions/xrpl-r5-recovery-batch-trigger/index.ts'",
      'XRPL_R5_RECOVERY_VERIFY_TOKEN="${recovery_token}"',
      'supabase functions deploy xrpl-r5-recovery-batch ',
      'supabase functions deploy xrpl-r5-recovery-batch-trigger ',
      'node scripts/verify-supabase-r5-first-recovery-batch.mjs',
      'verified-r5-first-recovery-batch.json',
      'node scripts/publish-supabase-r5-first-recovery-batch-run-locator.mjs',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow).toContain('RETIRED / NON-EXECUTABLE CONTRACT SNAPSHOT')
    expect(config).toContain('[functions.xrpl-r5-recovery-batch]')
    expect(config).toContain('[functions.xrpl-r5-recovery-batch-trigger]')
  })

  it('publishes success and failure without authorizing later R5 gates', () => {
    for (const required of [
      '## R5 first active recovery batch',
      '- first-batch verifier:',
      '- batch start ledger:',
      '- batch end ledger:',
      '- finalized egress upper bound bytes:',
      '- current observed lag:',
      '- active recovery started:',
      '- lag zero:',
      '- Mainnet disabled:',
      '- stabilization authorized:',
      '- soak authorized:',
    ]) {
      expect(publisher).toContain(required)
    }
  })
})
