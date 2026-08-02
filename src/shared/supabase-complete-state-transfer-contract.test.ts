import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260802220000_xrpl_complete_state_transfer.sql',
  ),
  'utf8',
)
const edge = readFileSync(
  resolve(process.cwd(), 'supabase/functions/xrpl-complete-state-transfer/index.ts'),
  'utf8',
)
const verifier = readFileSync(
  resolve(process.cwd(), 'scripts/verify-supabase-complete-state-transfer.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-remote-probe.yml'),
  'utf8',
)
const config = readFileSync(resolve(process.cwd(), 'supabase/config.toml'), 'utf8')

describe('Supabase isolated complete-state transfer contract', () => {
  it('covers collection, scheduler, publication, and maintenance state', () => {
    for (const required of [
      'create table if not exists public.xrpl_transfer_publication_candidates',
      'create table if not exists public.xrpl_transfer_publication_works',
      'create table if not exists public.xrpl_transfer_publication_watermarks',
      'create table if not exists public.xrpl_transfer_maintenance_plans',
      'create table if not exists public.xrpl_transfer_maintenance_mutations',
      "'collection', jsonb_build_object(",
      "'scheduler', jsonb_build_object(",
      "'publication', jsonb_build_object(",
      "'maintenance', jsonb_build_object(",
      "'messages', 6",
      "'successors', 5",
      "'referenceRows', 116",
      "'maintenanceMutations', 2",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('restores into an empty typed namespace and verifies canonical parity before return', () => {
    for (const required of [
      'create schema if not exists xrpl_restore_v1',
      '(like public.xrpl_phase_streams including all)',
      '(like public.xrpl_phase_messages including all)',
      '(like public.xrpl_phase_successors including all)',
      '(like public.xrpl_phase_work including all)',
      '(like public.xrpl_phase_payload_chunks including all)',
      '(like public.xrpl_phase_reference_rows including all)',
      '(like public.xrpl_phase_commit_chunks including all)',
      '(like public.xrpl_phase_watermarks including all)',
      'create or replace function public.xrpl_restore_multichunk_complete_state',
      "raise exception 'restore_target_not_empty:",
      'jsonb_populate_recordset(',
      "raise exception 'restore_parity_failure:",
      'v_restored_digest <> p_state_digest or v_restored_state <> p_state',
      "'duplicate', true",
      "'duplicate', false",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('binds export and restore to one exact isolated source', () => {
    for (const required of [
      "v_profile_id constant text := 'supabase-devnet-multichunk-witness'",
      "v_export_id text := 'r4c2c-multichunk-complete-state-v1'",
      "v_expected_target constant text := 'supabase-devnet-transfer-restore-v1'",
      "v_expected_export constant text := 'r4c2c-multichunk-complete-state-v1'",
      "'watermarkLedgerIndex', 2776760",
      "'watermarkLedgerHash', '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'",
      'public.xrpl_transfer_json_digest(v_state)',
      "raise exception 'restore_digest_mismatch:",
      "raise exception 'restore_source_mismatch:",
      "raise exception 'restore_row_count_mismatch:",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('independently hashes export and restored canonical text and checks active isolation', () => {
    for (const required of [
      "const PURPOSE = 'r4c2c-complete-state-transfer-qualification'",
      "const TARGET_ID = 'supabase-devnet-transfer-restore-v1'",
      "const EXPORT_ID = 'r4c2c-multichunk-complete-state-v1'",
      "'xrpl_export_multichunk_complete_state'",
      "'xrpl_restore_multichunk_complete_state'",
      "'xrpl_read_restored_multichunk_complete_state'",
      'await sha256(exported.stateCanonicalText) !== exported.stateDigest',
      'restored.stateCanonicalText !== exported.stateCanonicalText',
      'canonicalPortableJson(restored.state) !== canonicalPortableJson(exported.state)',
      'duplicateRestore.duplicate !== true',
      "'restore_digest_mismatch'",
      'activeProfileIsolated: true',
      'postRestoreContinuationProved: false',
    ]) {
      expect(edge).toContain(required)
    }
    expect(edge).toContain("request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')")
    expect(edge).not.toContain('MAINNET')
    expect(edge).not.toContain('submit')
  })

  it('retains only sanitized transfer evidence and rejection results', () => {
    for (const required of [
      'verified-complete-state-transfer.json',
      'failed-complete-state-transfer-verification.json',
      'canonicalTextBytes',
      'emptyTargetRestoreObserved',
      'duplicateRestoreConverged',
      'digestTamperRejected',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
      'postRestoreContinuationProved: false',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('sourceStateCanonicalText:')
    expect(verifier).not.toContain('restoredStateCanonicalText:')
    expect(verifier).not.toContain('verifierToken: verifierToken')
  })

  it('uses the existing guarded workflow and one rotated verifier token', () => {
    for (const required of [
      '[functions.xrpl-complete-state-transfer]',
      'verify_jwt = false',
    ]) {
      expect(config).toContain(required)
    }
    for (const required of [
      "'supabase/functions/xrpl-complete-state-transfer/index.ts'",
      'complete-state-transfer-bundle.json',
      'supabase functions deploy xrpl-complete-state-transfer',
      'node scripts/verify-supabase-complete-state-transfer.mjs',
      'verified-complete-state-transfer.json',
      'failed-complete-state-transfer-verification.json',
      'complete-state transfer verifier: `success`',
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
