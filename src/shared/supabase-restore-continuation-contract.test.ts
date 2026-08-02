import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260802233000_xrpl_post_restore_continuation.sql',
)
const edge = read('supabase/functions/xrpl-restore-continuation/index.ts')
const verifier = read('scripts/verify-supabase-restore-continuation.mjs')
const publisher = read('scripts/publish-supabase-run-locator.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')
const config = read('supabase/config.toml')

describe('Supabase isolated post-restore continuation contract', () => {
  it('restores one exact consecutive active-work boundary into a dedicated typed namespace', () => {
    for (const required of [
      'create schema if not exists xrpl_restore_continuation_v1',
      '(like public.xrpl_phase_streams including all)',
      '(like public.xrpl_phase_messages including all)',
      '(like public.xrpl_phase_successors including all)',
      '(like public.xrpl_phase_work including all)',
      '(like public.xrpl_phase_payload_chunks including all)',
      '(like public.xrpl_phase_reference_rows including all)',
      '(like public.xrpl_phase_commit_chunks including all)',
      '(like public.xrpl_phase_watermarks including all)',
      "v_source_profile_id constant text := 'supabase-devnet-restore-continuation-source'",
      "v_active_profile_id constant text := 'supabase-devnet'",
      "v_target_id constant text := 'supabase-devnet-restore-continuation-v1'",
      'v_continuation.start_ledger_index <> v_anchor.scanned_end_ledger_index + 1',
      'v_continuation.expected_parent_hash <> v_anchor.final_ledger_hash',
      'v_restored_state <> v_source_state',
      'public.xrpl_restore_continuation_row_counts() <> v_counts',
      "raise exception 'restore_continuation_target_not_empty'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('executes restored scan, ordered commits, finalize, watermark advance, and next scan', () => {
    for (const required of [
      'create or replace function public.xrpl_claim_restored_continuation_phase',
      'for update skip locked',
      'attempt_count = attempt_count + 1',
      'create or replace function public.xrpl_complete_restored_continuation_scan',
      'create or replace function public.xrpl_complete_restored_continuation_commit',
      'create or replace function public.xrpl_complete_restored_continuation_finalize',
      'sourceReboundFrom',
      'sourceReboundTo',
      'restore continuation commit chunks are out of order',
      'restore continuation reference rows are incomplete',
      'ledger_index = v_work.scanned_end_ledger_index',
      'work_id = v_work.work_id',
      'perform public.xrpl_restore_continuation_insert_message(',
      "'scan', v_next_scan_id",
      'set continued_at = p_completed_at',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('proves committed-row parity and explicit source rebinding without active mutation', () => {
    for (const required of [
      'create or replace function public.xrpl_read_restored_continuation_evidence',
      'activeContinuationRowCount',
      'continuationRowsDigest',
      'activeContinuationRowsDigest',
      "'watermarkAdvancedExactlyOne'",
      "'watermarkMatchesDurableSource'",
      "'workCommitted'",
      "'committedRowsOnly'",
      "'rowCountParity'",
      "'rowDigestParity'",
      "'sourceReboundExplicitly'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("update public.xrpl_phase_watermarks\n  set")
    expect(migration).not.toContain("delete from public.xrpl_phase_watermarks")
  })

  it('uses a token-gated idempotent Edge verifier and duplicate phase replay', () => {
    for (const required of [
      "const PURPOSE = 'r4c2c-restore-continuation-qualification'",
      "const RESTORED_SOURCE_PROFILE_ID = 'supabase-devnet-restore-continuation-source'",
      "const TARGET_ID = 'supabase-devnet-restore-continuation-v1'",
      "'xrpl_prepare_restored_continuation'",
      "'xrpl_claim_restored_continuation_phase'",
      "'xrpl_complete_restored_continuation_scan'",
      "'xrpl_complete_restored_continuation_commit'",
      "'xrpl_complete_restored_continuation_finalize'",
      "'xrpl_read_restored_continuation_evidence'",
      'duplicatePhaseReplayConverged: true',
      'postRestoreContinuationProved: true',
      'verifyActiveIsolation(activeBefore, activeAfter)',
      "request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')",
    ]) {
      expect(edge).toContain(required)
    }
    expect(edge).not.toContain('MAINNET')
    expect(edge).not.toContain('submit')
  })

  it('retains sanitized continuation, credential, and active-isolation evidence', () => {
    for (const required of [
      'verified-restore-continuation.json',
      'failed-restore-continuation-verification.json',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
      'duplicatePhaseReplayCount',
      'postRestoreContinuationProved: true',
      'activeWatermarkBefore',
      'activeWatermarkAfter',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('verifierToken: verifierToken')
    expect(publisher).toContain('restore continuation verifier')
    expect(publisher).toContain('verified-restore-continuation.json')
    expect(publisher).toContain('failed-restore-continuation-verification.json')
  })

  it('deploys the eighth function through the existing single guarded workflow', () => {
    expect(config).toContain('[functions.xrpl-restore-continuation]')
    expect(config.match(/verify_jwt = false/g)).toHaveLength(9)
    for (const required of [
      "'supabase/functions/xrpl-restore-continuation/index.ts'",
      'restore-continuation-bundle.json',
      'supabase functions deploy xrpl-restore-continuation',
      'node scripts/verify-supabase-restore-continuation.mjs',
      'node scripts/publish-supabase-run-locator.mjs',
      'gh issue comment 1109',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/supabase secrets set XRPL_READER_VERIFY_TOKEN/g)).toHaveLength(1)
    expect(workflow.match(/gh issue comment 1109/g)).toHaveLength(1)
    expect(workflow).not.toContain('  schedule:')
  })
})
