import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const verifier = read('scripts/verify-supabase-r5-recovery-prepare.mjs')
const publisher = read(
  'scripts/publish-supabase-r5-recovery-prepare-run-locator.mjs',
)
const workflow = read(
  'ops/retired/supabase-remote-probe-r4c-r5-workflow.snapshot.yml',
)
const selection = JSON.parse(
  read('docs/ops/r4e-deployment-profile-selection-2026-08-03.json'),
) as {
  selectedProfile: {
    profileId: string
    profileRevision: number
    profileIdentityDigest: string
  }
  selectionDigest: string
}

describe('R5 Supabase remote recovery preparation contract', () => {
  it('uses parameterized Management API queries without a preparation Edge function', () => {
    for (const required of [
      'https://api.supabase.com/v1/projects/${projectRef}/database/query',
      "authorization: `Bearer ${accessToken}`",
      "query:\n        'select public.xrpl_read_r5_active_checkpoint($1::text) as checkpoint'",
      "query: 'select public.xrpl_read_r5_active_recovery($1::text) as recovery'",
      'select public.xrpl_prepare_r5_active_recovery($1::text, $2::text, $3::text, $4::bigint, $5::text, statement_timestamp()) as recovery',
      'parameters: [checkpointId]',
      'parameters: [recoveryRunId]',
      'read_only: readOnly',
      'readOnly: true',
      'readOnly: false',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(workflow).not.toContain('supabase functions deploy xrpl-r5-recovery-prepare')
    expect(workflow).not.toContain(
      "bundle_function 'supabase/functions/xrpl-r5-recovery-prepare",
    )
  })

  it('requires the frozen checkpoint and exact selected identity', () => {
    for (const required of [
      "const checkpointId = 'r5-checkpoint-selected-revision3-entry'",
      "const recoveryRunId = 'r5-recovery-selected-revision3-entry'",
      selection.selectedProfile.profileId,
      String(selection.selectedProfile.profileRevision),
      selection.selectedProfile.profileIdentityDigest,
      selection.selectionDigest,
      'checkpoint.checkpointId !== checkpointId',
      'checks.storedStateDigestValid !== true',
      'checks.exactRevision3Identity !== true',
      'checks.exactSelectionBound !== true',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('prepares once, then rereads the same deterministic recovery run', () => {
    for (const required of [
      'const existing = await readRecovery()',
      'if (existing.found === true)',
      'const prepared = await prepareRecovery(checkpoint, validatedHead)',
      'preparedNow = true',
      'const reread = await readRecovery()',
      "throw new Error('prepared R5 recovery cannot be reread')",
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('retries only transient quiescence, head race, lock, and transport failures', () => {
    for (const required of [
      'r5_recovery_prepare_collector_not_quiescent',
      'r5_recovery_prepare_scheduler_not_quiescent',
      'r5_recovery_prepare_inflight_work_present',
      'r5_recovery_prepare_head_behind_watermark',
      'canceling statement due to lock timeout',
      'could not serialize access',
      'deadlock detected',
      'response.status === 429',
      'response.status === 502',
      'response.status === 503',
      'response.status === 504',
      "if (!(error instanceof QueryError) || error.transient !== true) throw error",
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain("'r5_recovery_prepare_identity_conflict',")
    expect(verifier).not.toContain("'r5_recovery_prepare_checkpoint_invalid',")
  })

  it('verifies checkpoint descendant, lag, and zero-execution boundaries', () => {
    for (const required of [
      "recovery.purpose !== 'r5-supabase-active-recovery-summary'",
      "!['prepared', 'caught_up'].includes(recovery.status)",
      'recovery.batchSize !== 24',
      'checkpointToStartLedgers',
      'descendantWorkCount !== checkpointToStartLedgers',
      'initialLagLedgers !== initialHead.ledgerIndex - startWatermark.ledgerIndex',
      'currentWatermark.ledgerIndex !== startWatermark.ledgerIndex',
      "requiredInteger(recovery.completedBatches, 'completedBatches') !== 0",
      "requiredInteger(recovery.committedLedgers, 'committedLedgers') !== 0",
      'recovery.lastAccountingDigest !== null',
      'recovery.lastError !== null',
      'recovery.startedAt !== null',
      'checks.activeRecoveryStarted !== false',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('independently retains bounded Devnet head and current lag', () => {
    for (const required of [
      "const xrplEndpoint = 'https://s.devnet.rippletest.net:51234/'",
      "method: 'server_info'",
      'Buffer.byteLength(text) > 256 * 1024',
      'const currentValidatedHead = await readValidatedHead()',
      'currentValidatedHead.ledgerIndex - verified.currentWatermark.ledgerIndex',
      'initialValidatedHead: verified.initialHead',
      'currentValidatedHead',
      'currentObservedLag',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('retains sanitized evidence with every later boundary disabled', () => {
    for (const required of [
      'verified-r5-recovery-prepare.json',
      'failed-r5-recovery-prepare-verification.json',
      "purpose: 'r5-supabase-active-recovery-prepare-verification'",
      'zeroRecoveryBatchesCommitted: true',
      'activeRecoveryStarted: false',
      'r5RecoveryAuthorized: true',
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('SUPABASE_DB_PASSWORD')
    expect(verifier).not.toContain('fullCheckpointState')
  })

  it('retains the historical checkpoint/readiness ordering and R5 tracker publication', () => {
    for (const required of [
      "'scripts/verify-supabase-r5-recovery-prepare.mjs'",
      "'scripts/verify-supabase-r5-recovery-ready.mjs'",
      "'scripts/publish-supabase-r5-recovery-prepare-run-locator.mjs'",
      'Freeze exact R5 active checkpoint',
      'Prepare or verify exact R5 active recovery',
      'node scripts/verify-supabase-r5-active-checkpoint.mjs',
      'node scripts/verify-supabase-r5-recovery-ready.mjs',
      'node scripts/publish-supabase-r5-active-checkpoint-run-locator.mjs > /tmp/r5-comment.md',
      'node scripts/publish-supabase-r5-recovery-prepare-run-locator.mjs >> /tmp/r5-comment.md',
      'gh issue comment 1175',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow).toContain('RETIRED / NON-EXECUTABLE CONTRACT SNAPSHOT')
    expect(
      workflow.indexOf('node scripts/verify-supabase-r5-active-checkpoint.mjs'),
    ).toBeLessThan(workflow.indexOf('node scripts/verify-supabase-r5-recovery-ready.mjs'))
    expect(workflow.match(/gh issue comment 1175/g)).toHaveLength(1)
  })

  it('publishes the checkpoint, start, head, lag, chain, and execution state', () => {
    for (const required of [
      'preparation verifier',
      'recovery run ID',
      'checkpoint state digest',
      'checkpoint watermark ledger',
      'active start watermark ledger',
      'checkpoint-to-start ledgers',
      'descendant committed works',
      'initial validated head',
      'initial lag',
      'current validated head',
      'current observed lag',
      'checkpoint descendant chain proved',
      'one-ledger hash continuity proved',
      'zero recovery batches committed',
      'active recovery started',
    ]) {
      expect(publisher).toContain(required)
    }
  })
})
