import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const verifier = read('scripts/verify-supabase-r5-active-checkpoint.mjs')
const publisher = read(
  'scripts/publish-supabase-r5-active-checkpoint-run-locator.mjs',
)
const workflow = read('.github/workflows/supabase-remote-probe.yml')
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

describe('R5 Supabase active checkpoint remote freeze contract', () => {
  it('uses the official parameterized Management API without adding a checkpoint Edge function', () => {
    for (const required of [
      'https://api.supabase.com/v1/projects/${projectRef}/database/query',
      "authorization: `Bearer ${accessToken}`",
      "query:\n        'select public.xrpl_read_r5_active_checkpoint($1::text) as checkpoint'",
      "query:\n        'select public.xrpl_create_r5_active_checkpoint($1::text, statement_timestamp()) as checkpoint'",
      'parameters: [checkpointId]',
      'read_only: readOnly',
      'readOnly: true',
      'readOnly: false',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(workflow).not.toContain('supabase functions deploy xrpl-r5-active-checkpoint')
    expect(workflow).not.toContain(
      "bundle_function 'supabase/functions/xrpl-r5-active-checkpoint",
    )
  })

  it('freezes one deterministic checkpoint and rereads existing state on later runs', () => {
    for (const required of [
      "const checkpointId = 'r5-checkpoint-selected-revision3-entry'",
      'const existing = await readCheckpoint()',
      'if (existing.found === true)',
      'const created = await createCheckpoint()',
      'const reread = await readCheckpoint()',
      "throw new Error('created R5 checkpoint cannot be reread')",
      'checkpointRereadParity: true',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('retries only transient quiescence and transport conditions', () => {
    for (const required of [
      'r5_checkpoint_collector_not_quiescent',
      'r5_checkpoint_scheduler_not_quiescent',
      'r5_checkpoint_inflight_work_present',
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
    expect(verifier).not.toContain("'r5_checkpoint_identity_conflict',")
  })

  it('binds the remote summary to the exact selected revision-3 identity', () => {
    for (const required of [
      selection.selectedProfile.profileId,
      String(selection.selectedProfile.profileRevision),
      selection.selectedProfile.profileIdentityDigest,
      selection.selectionDigest,
      "checkpoint.sourceProfileId !== 'supabase-devnet'",
      "checkpoint.network !== 'devnet'",
      "checkpoint.epochId !== 'supabase-r4c2c-v1'",
      "checkpoint.purpose !== 'r5-supabase-active-recovery-checkpoint-summary'",
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('verifies exact section digests, quiescent counts, and a bounded Devnet head', () => {
    for (const required of [
      "'runtime'",
      "'stream'",
      "'watermark'",
      "'messages'",
      "'successors'",
      "'work'",
      "'payloadChunks'",
      "'referenceRows'",
      "'commitChunks'",
      "'resourceAccounting'",
      'pendingMessages: 1',
      'leasedMessages: 0',
      'retryMessages: 0',
      'inflightWork: 0',
      "const xrplEndpoint = 'https://s.devnet.rippletest.net:51234/'",
      "method: 'server_info'",
      'Buffer.byteLength(text) > 256 * 1024',
      'const startingLag = validatedHead.ledgerIndex - verified.watermarkLedgerIndex',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('retains only sanitized evidence and preserves all later boundaries', () => {
    for (const required of [
      'verified-r5-active-checkpoint.json',
      'failed-r5-active-checkpoint-verification.json',
      "purpose: 'r5-supabase-active-recovery-checkpoint-verification'",
      'activeRecoveryStarted: false',
      'r5RecoveryAuthorized: true',
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('fullCheckpointState')
    expect(verifier).not.toContain('SUPABASE_DB_PASSWORD')
  })

  it('runs from the existing guarded workflow and publishes only to the R5 tracker', () => {
    for (const required of [
      "'scripts/verify-supabase-r5-active-checkpoint.mjs'",
      "'scripts/publish-supabase-r5-active-checkpoint-run-locator.mjs'",
      'Freeze exact R5 active checkpoint',
      'node scripts/verify-supabase-r5-active-checkpoint.mjs',
      'node scripts/publish-supabase-r5-active-checkpoint-run-locator.mjs',
      'gh issue comment 1175',
      'if [ -s /tmp/r5-comment.md ]; then',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/gh issue comment 1109/g)).toHaveLength(1)
    expect(workflow.match(/gh issue comment 1175/g)).toHaveLength(1)
  })

  it('publishes checkpoint identity, lag, digest, and authorization boundaries', () => {
    for (const required of [
      'checkpoint verifier',
      'checkpoint watermark ledger',
      'validated Devnet head',
      'starting lag',
      'checkpoint state digest',
      'revision-3 quota state included',
      'active recovery started',
      'R5 recovery authorized',
      'public reader unchanged',
      'Mainnet disabled',
      'stabilization authorized',
      'soak authorized',
    ]) {
      expect(publisher).toContain(required)
    }
  })
})
