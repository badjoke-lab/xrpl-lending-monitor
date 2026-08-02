import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('R4C2c isolated Supabase historical witness profile', () => {
  const migration = read(
    'supabase/migrations/20260802193000_xrpl_historical_witness_profile.sql',
  )
  const loader = read('supabase/functions/xrpl-historical-witness/index.ts')
  const reader = read('supabase/functions/xrpl-historical-witness-reader/index.ts')
  const verifier = read('scripts/verify-supabase-historical-witness.mjs')
  const workflow = read('.github/workflows/supabase-remote-probe.yml')
  const config = read('supabase/config.toml')

  it('isolates the non-contiguous witness set from the active Supabase stream', () => {
    for (const required of [
      'create table if not exists public.xrpl_historical_witness_sets',
      'create table if not exists public.xrpl_historical_witness_rows',
      "profile_id = 'supabase-devnet-historical-witness'",
      "epoch_id = 'supabase-r4c2c-historical-witness-v1'",
      "base_identity = 'historical-witness-2776760-2980845-3127240'",
      'fence_ledger_index = 3127240',
      'source_ledger_index in (2776760, 2980845, 3127240)',
      'source_run_id = 30741004656',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('insert into public.xrpl_phase_streams')
    expect(migration).not.toContain('update public.xrpl_phase_watermarks')
  })

  it('commits exactly 237 fixed rows atomically and converges duplicate execution', () => {
    for (const required of [
      'create or replace function public.xrpl_commit_historical_witness',
      "v_expected_set_id constant text := 'r4c2c-devnet-historical-witness-v1'",
      "v_work_id constant text := 'historical-witness-work-v1:2776760:2980845:3127240'",
      'jsonb_array_length(v_records) <> 237',
      'duplicate semantic class and canonical key',
      'relationships are not sorted and unique',
      'records are not in canonical order',
      'semantic counts do not match the fixed evidence',
      "status = 'committed'",
      "'duplicate', true",
      "set status = 'committed', committed_at = p_committed_at",
      "'recordCount', 237",
    ]) {
      expect(migration).toContain(required)
    }
    for (const [semanticClass, count] of Object.entries({
      'validated-ledger': 3,
      'protocol-event': 13,
      'object-change': 197,
      'loan-lifecycle': 3,
      'archived-object': 1,
      'balance-history': 2,
      'current-projection': 18,
    })) {
      expect(migration).toContain(`'${semanticClass}', ${count}`)
      expect(loader).toContain(`'${semanticClass}': ${count}`)
    }
  })

  it('rebuilds the exact real Devnet witness with the canonical parser and normalizer', () => {
    for (const required of [
      '2_776_760',
      '2_980_845',
      '3_127_240',
      '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D',
      '5BA95992F3E649752BBA5550EEEF79DEB535881E10FF7C1D4F9EF953340B0C40',
      '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3',
      'parseValidatedLedgerResult',
      'isLendingTransactionType',
      'buildPortableXrplNormalizedWork',
      'portableReferenceRowsFromChunk',
      'canonicalPortableJson(rows)',
      'rows.length !== 237',
    ]) {
      expect(loader).toContain(required)
    }
    for (const forbidden of ['submit_multisigned', "method: 'submit'", 'wallet_propose', 'seed']) {
      expect(loader).not.toContain(forbidden)
    }
  })

  it('keeps both loader and reader token-gated and qualification-only', () => {
    for (const surface of [loader, reader]) {
      for (const required of [
        "const PURPOSE = 'r4c2c-historical-witness-qualification'",
        "const PURPOSE_HEADER = 'x-xrpl-reader-purpose'",
        "const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'",
        "env('XRPL_READER_VERIFY_TOKEN')",
        "request.method !== 'POST'",
        "'cache-control': 'no-store'",
      ]) {
        expect(surface).toContain(required)
      }
      expect(surface).not.toContain('MAINNET')
      expect(surface).not.toContain('public reader')
    }
  })

  it('provides committed-only exact, semantic, range, and relationship reads', () => {
    for (const required of [
      'create or replace function public.xrpl_read_historical_witness_page',
      "p_kind not in ('fence', 'exact', 'semantic', 'ledger_range', 'relationship')",
      "v_set.status <> 'committed'",
      'v_set.committed_at is null',
      'record_count <> 237',
      'historical witness row count does not match its set',
      "raise exception 'stale_cursor: historical witness fence changed'",
      'rows.relationship_ids ? p_relationship_id',
      'limit p_limit + 1',
      'v_rows := v_rows - p_limit',
    ]) {
      expect(migration).toContain(required)
    }
    for (const required of [
      "const SOURCE_ID = 'supabase-r4c2c-historical-witness'",
      "const CURSOR_PREFIX = 'pcr1'",
      'cursor digest mismatch',
      'cursor belongs to another reader source',
      'cursor query identity does not match the request',
      'cursor read fence is no longer current',
      'reader rows are not deterministically ordered',
      'relationshipIds are not canonical',
      'valueJson is not canonical',
    ]) {
      expect(reader).toContain(required)
    }
  })

  it('remotely verifies all 237 rows, every class, relationships, and rejection boundaries', () => {
    for (const required of [
      'full.rows.length !== 237',
      'canonicalJson([100, 100, 37])',
      'new Set(full.rows.map(rowIdentity)).size',
      'for (const [semanticClass, expectedCount] of Object.entries(expectedCounts))',
      'for (const [semanticClass, canonicalKey] of exactWitnesses)',
      'relationship.rows.length < 3',
      "'loan-lifecycle', 'archived-object', 'current-projection'",
      'cursorDigestTamperRejected',
      'cursorQueryOrderMismatchRejected',
      'cursorSourceMismatchRejected',
      'staleFenceRejected',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
      'secondLoad.commit?.duplicate !== true',
      'verified-historical-witness.json',
      'failed-historical-witness-verification.json',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('deploys both isolated functions through the one guarded Supabase workflow', () => {
    for (const required of [
      "'supabase/functions/xrpl-historical-witness/index.ts'",
      "'supabase/functions/xrpl-historical-witness-reader/index.ts'",
      'historical-loader-bundle.json',
      'historical-reader-bundle.json',
      'supabase functions deploy xrpl-historical-witness',
      'supabase functions deploy xrpl-historical-witness-reader',
      'node scripts/verify-supabase-historical-witness.mjs',
      'verified-historical-witness.json',
      'failed-historical-witness-verification.json',
      'historical witness verifier: `success`',
      'gh issue comment 1109',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(config).toContain('[functions.xrpl-historical-witness]')
    expect(config).toContain('[functions.xrpl-historical-witness-reader]')
    expect(config.match(/verify_jwt = false/g)).toHaveLength(4)
    expect(workflow.match(/gh issue comment 1109/g)).toHaveLength(1)
    expect(workflow.match(/supabase secrets set XRPL_READER_VERIFY_TOKEN/g)).toHaveLength(1)
  })
})
