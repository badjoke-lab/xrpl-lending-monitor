import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('R4C2c Supabase committed reader contract', () => {
  const migration = read(
    'supabase/migrations/20260802162000_xrpl_remote_committed_reader.sql',
  )
  const reader = read('supabase/functions/xrpl-committed-reader/index.ts')
  const verifier = read('scripts/verify-supabase-committed-reader.mjs')
  const workflow = read('.github/workflows/supabase-remote-probe.yml')
  const config = read('supabase/config.toml')
  const allowlist = read('scripts/check-actions-workflow-allowlist.sh')

  it('keeps the reader qualification-only, Devnet-bound, and separate from the public app', () => {
    for (const required of [
      "const PROFILE_ID = 'supabase-devnet'",
      "const SOURCE_ID = 'supabase-r4c2c-qualification'",
      "const EPOCH_ID = 'supabase-r4c2c-v1'",
      "const PURPOSE = 'r4c2c-qualification'",
      "purpose: 'r4-qualification-only'",
      "request.headers.get('x-xrpl-reader-purpose')",
      "request.method !== 'POST'",
      "'cache-control': 'no-store'",
      "env('SUPABASE_URL')",
      'secretKey()',
    ]) {
      expect(reader).toContain(required)
    }
    expect(reader).not.toContain('MAINNET')
    expect(reader).not.toContain('legacy')
    expect(reader).not.toContain('public reader')
  })

  it('builds one immutable fence from the active stream, watermark, and committed work', () => {
    for (const required of [
      'create or replace function public.xrpl_read_committed_page',
      "where profile_id = 'supabase-devnet'",
      "v_stream.network <> 'devnet'",
      "v_stream.epoch_id <> 'supabase-r4c2c-v1'",
      "v_stream.status <> 'active'",
      'where profile_id = v_stream.profile_id',
      'where work_id = v_watermark.work_id',
      "v_work.status <> 'committed'",
      'v_work.committed_at is null',
      'v_work.scanned_end_ledger_index <> v_watermark.ledger_index',
      'v_work.final_ledger_hash <> v_watermark.ledger_hash',
      "'schemaVersion', 1",
      "'ledgerIndex', v_watermark.ledger_index",
      "'workId', v_watermark.work_id",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('rejects partial, stale, malformed, and cross-source cursors', () => {
    for (const required of [
      'v_expected_count not in (0, 5)',
      "raise exception 'stale_cursor: committed read fence advanced'",
      "const CURSOR_PREFIX = 'pcr1'",
      'MAX_CURSOR_BYTES = 16_000',
      'cursor digest mismatch',
      'cursor belongs to another reader source',
      'cursor query identity does not match the request',
      'cursor read fence is no longer current',
      'sourceId: SOURCE_ID',
      'fence: at',
      'query: requested',
    ]) {
      expect(`${migration}\n${reader}`).toContain(required)
    }
  })

  it('exposes only bounded committed rows inside the exact work and watermark range', () => {
    for (const required of [
      "work.status = 'committed'",
      'work.committed_at is not null',
      'work.scanned_end_ledger_index <= v_watermark.ledger_index',
      'rows.source_ledger_index between work.start_ledger_index and work.scanned_end_ledger_index',
      'rows.source_ledger_index <= v_watermark.ledger_index',
      'p_limit > 100',
      'limit p_limit + 1',
      'v_rows := v_rows - p_limit',
      "p_kind not in ('fence', 'exact', 'semantic', 'ledger_range', 'relationship')",
      "p_order not in ('asc', 'desc')",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).toContain(
      'revoke all on function public.xrpl_read_committed_page',
    )
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('preserves deterministic exact, semantic, range, relationship, and tombstone semantics', () => {
    for (const semanticClass of [
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'balance-history',
      'current-projection',
    ]) {
      expect(migration).toContain(`'${semanticClass}'`)
      expect(reader).toContain(`'${semanticClass}'`)
    }
    for (const required of [
      "p_kind = 'exact'",
      "p_kind = 'semantic'",
      "p_kind = 'ledger_range'",
      "p_kind = 'relationship'",
      'rows.relationship_ids ? p_relationship_id',
      'rows.source_ledger_index asc',
      'rows.semantic_class asc',
      'rows.canonical_key asc',
      'rows.work_id asc',
      'reader rows are not deterministically ordered',
      'current-projection tombstone exposes a value',
      'valueJson is not canonical',
      'relationshipIds are not canonical',
    ]) {
      expect(`${migration}\n${reader}`).toContain(required)
    }
  })

  it('remotely verifies continuation and all cursor rejection boundaries', () => {
    for (const required of [
      "functions/v1/xrpl-committed-reader",
      "'x-xrpl-reader-purpose': 'r4c2c-qualification'",
      'reader has fewer than two committed validated-ledger rows',
      'cursor continuation changed the immutable fence',
      'exact lookup does not match the paginated row',
      'ledger range lookup omitted a cursor row',
      'cursorDigestTamperRejected: true',
      'cursorQueryOrderMismatchRejected: true',
      'cursorSourceMismatchRejected: true',
      'staleFenceRejected: true',
      'verified-reader.json',
      'failed-reader-verification.json',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('deploys both exact bundles through the one guarded Supabase workflow', () => {
    for (const required of [
      "supabase/functions/xrpl-committed-reader/index.ts",
      'reader-bundle.json',
      'supabase functions deploy xrpl-committed-reader',
      'node scripts/verify-supabase-committed-reader.mjs',
      'committed reader verifier: `success`',
      'gh issue comment 1109',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
      expect(allowlist).toContain(required)
    }
    expect(config).toContain('[functions.xrpl-committed-reader]')
    expect(config).toContain('verify_jwt = false')
    expect(workflow.match(/gh issue comment 1109/g)).toHaveLength(1)
  })
})
