import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260802203500_xrpl_multichunk_witness_profile.sql',
  ),
  'utf8',
)
const executor = readFileSync(
  resolve(process.cwd(), 'supabase/functions/xrpl-multichunk-witness/index.ts'),
  'utf8',
)
const reader = readFileSync(
  resolve(
    process.cwd(),
    'supabase/functions/xrpl-multichunk-witness-reader/index.ts',
  ),
  'utf8',
)
const verifier = readFileSync(
  resolve(process.cwd(), 'scripts/verify-supabase-multichunk-witness.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-remote-probe.yml'),
  'utf8',
)
const config = readFileSync(resolve(process.cwd(), 'supabase/config.toml'), 'utf8')

describe('Supabase isolated standard-phase multi-chunk witness contract', () => {
  it('seeds and claims only the exact isolated profile', () => {
    for (const required of [
      'supabase-devnet-multichunk-witness',
      'supabase-r4c2c-v1',
      'multichunk-witness-2776760',
      '2776759',
      'E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628',
      '2776760',
      '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D',
      'xrpl_phase_insert_message',
      'xrpl_claim_multichunk_witness_phase',
      "where profile_id = 'supabase-devnet-multichunk-witness'",
      "reason', 'already_committed'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("update public.xrpl_phase_watermarks\n  set profile_id = 'supabase-devnet'")
    expect(migration).not.toContain("delete from public.xrpl_phase_watermarks\n  where profile_id = 'supabase-devnet'")
  })

  it('executes the real ledger through the standard scan, commit, and finalize RPCs', () => {
    for (const required of [
      "const PROFILE_ID = 'supabase-devnet-multichunk-witness'",
      "const EPOCH_ID = 'supabase-r4c2c-v1'",
      "const BASE_IDENTITY = 'multichunk-witness-2776760'",
      'const EXPECTED_CHUNK_RECORD_COUNTS = [40, 40, 36]',
      'buildPortableXrplNormalizedWork',
      'xrpl_claim_multichunk_witness_phase',
      'xrpl_complete_portable_scan_phase',
      'xrpl_complete_portable_commit_phase',
      'xrpl_complete_portable_finalize_phase',
      'decodeAndVerifyNormalizedPayloadChunk',
      'portableReferenceRowsFromChunk',
      "phase: 'scan'",
      "phase: 'commit'",
      "phase: 'finalize'",
      'activeWatermarkIsolated: true',
      'new TextEncoder().encode(stored.payload_json).byteLength',
    ]) {
      expect(executor).toContain(required)
    }
    expect(executor).toContain("'x-xrpl-reader-purpose'")
    expect(executor).toContain("'x-xrpl-reader-token'")
    expect(executor).not.toContain('MAINNET')
    expect(executor).not.toContain('submit')
  })

  it('requires one committed work with exactly three payload and commit chunks', () => {
    for (const required of [
      'v_work.expected_payload_chunks <> 3',
      'v_work.expected_commit_chunks <> 3',
      "where profile_id = 'supabase-devnet-multichunk-witness'",
      "v_stream.base_identity <> 'multichunk-witness-2776760'",
      "raise exception 'integrity_failure: multi-chunk witness watermark does not match its work'",
      "where rows.work_id = v_work.work_id",
      'p_expected_work_id <> v_watermark.work_id',
      "raise exception 'stale_cursor: multi-chunk witness read fence changed'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('binds committed-reader continuation to source, query, order, and fence', () => {
    for (const required of [
      "const SOURCE_ID = 'supabase-r4c2c-multichunk-witness'",
      "const CURSOR_PREFIX = 'pcr1'",
      'sourceId: SOURCE_ID',
      'fence: at',
      'query: requested',
      'offset: offset + rows.length',
      "throw new ReaderError('invalid_cursor', 'cursor belongs to another source')",
      "throw new ReaderError('invalid_cursor', 'cursor query or order does not match')",
      "throw new ReaderError('stale_cursor', 'reader fence changed')",
      'compareRows(rows[index - 1]!, rows[index]!, requested.order)',
      "request.headers.get(PURPOSE_HEADER) !== PURPOSE",
      "request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')",
    ]) {
      expect(reader).toContain(required)
    }
  })

  it('verifies 40/40/36 execution and reader pages without retaining the token', () => {
    for (const required of [
      "const expectedChunkCounts = [40, 40, 36]",
      "['scan', 'commit:0', 'commit:1', 'commit:2', 'finalize']",
      'full.rows.length !== 116',
      'canonicalJson(full.pageSizes) !== canonicalJson(expectedChunkCounts)',
      'cursorDigestTamperRejected',
      'cursorQueryOrderMismatchRejected',
      'cursorSourceMismatchRejected',
      'staleFenceRejected',
      'activeWatermarkIsolated',
      'activeWatermarkBefore',
      'activeWatermarkAfter',
      'verified-multichunk-witness.json',
      'failed-multichunk-witness-verification.json',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).toContain("'x-xrpl-reader-token': verifierToken")
    expect(verifier).not.toContain('verifierToken: verifierToken')
    expect(verifier).not.toContain('XRPL_READER_VERIFY_TOKEN: verifierToken')
  })

  it('uses the existing single guarded deployment workflow and one rotated token', () => {
    for (const required of [
      '[functions.xrpl-multichunk-witness]',
      '[functions.xrpl-multichunk-witness-reader]',
      'verify_jwt = false',
    ]) {
      expect(config).toContain(required)
    }
    expect(workflow).toContain('supabase functions deploy xrpl-multichunk-witness')
    expect(workflow).toContain('supabase functions deploy xrpl-multichunk-witness-reader')
    expect(workflow).toContain('node scripts/verify-supabase-multichunk-witness.mjs')
    expect(workflow.match(/supabase secrets set XRPL_READER_VERIFY_TOKEN/g)).toHaveLength(1)
    expect(workflow).not.toContain('  schedule:')
  })
})
