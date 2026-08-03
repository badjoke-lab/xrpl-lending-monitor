import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803110000_xrpl_steady_retained_anchor.sql',
)
const tick = read('supabase/functions/xrpl-steady-batch-tick/index.ts')
const verifier = read('scripts/verify-supabase-steady-throughput.mjs')
const revision3Verifier = read('scripts/verify-supabase-revision3-accounting.mjs')

describe('Supabase retained-anchor steady qualification contract', () => {
  it('captures an exact historical 145-work chain ending at the active watermark', () => {
    for (const required of [
      'create or replace function public.xrpl_prepare_network_steady_session',
      "work.profile_id = 'supabase-devnet'",
      "work.epoch_id = 'supabase-r4c2c-v1'",
      "work.status = 'committed'",
      'work.start_ledger_index <= v_active_watermark.ledger_index',
      'limit 145',
      'v_retained_count <> 145',
      'steady retained source window is incomplete',
      'ordered.start_ledger_index = ordered.previous_ledger_index + 1',
      'ordered.scanned_end_ledger_index = ordered.start_ledger_index',
      'ordered.expected_parent_hash = ordered.prior_final_ledger_hash',
      'steady retained source window is not a contiguous one-ledger chain',
      'v_target.work_id <> v_active_watermark.work_id',
      'v_target.scanned_end_ledger_index <> v_active_watermark.ledger_index',
      'v_target.final_ledger_hash <> v_active_watermark.ledger_hash',
      'targetBoundToCapturedActiveWatermark',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('uses the oldest retained work as the immutable anchor for the following 144 ledgers', () => {
    for (const required of [
      'order by start_ledger_index, work_id',
      'v_target.scanned_end_ledger_index <> v_anchor.scanned_end_ledger_index + 144',
      "'running', 6, 24",
      'v_anchor.scanned_end_ledger_index, v_anchor.final_ledger_hash, v_anchor.work_id',
      'v_stream.epoch_id, v_stream.base_identity',
      "'sourceMode', 'retained-contiguous-network-replay'",
      "'retainedWorkCount', v_retained_count",
      "'exact145RetainedWorks', v_retained_count = 145",
      "'exact144LedgerAdvance'",
      "'activeSourceIdentityPreserved', true",
      "'activeProfileReadOnly', true",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains real network fetches and the strict six consecutive minute condition', () => {
    for (const required of [
      'readValidatedHead(endpoint, meter)',
      'readExactLedger(endpoint, ledgerIndex, meter)',
      'transactions: true',
      'expand: true',
      "'xrpl_complete_network_steady_tick'",
    ]) {
      expect(tick).toContain(required)
    }
    for (const required of [
      'session.completedTicks !== 6',
      'session.committedLedgers !== 144',
      'scheduled - previous !== 60_000',
      'tick.workCount !== 24',
      'sixConsecutiveMinuteBuckets: true',
      'networkFetchAndNormalizationMeasured: true',
      'fullPhaseAtomicBatchMeasured: true',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(revision3Verifier).toContain('current - previous !== 60_000')
  })

  it('does not authorize selection or production boundaries', () => {
    expect(migration).not.toContain("profile_selected = true")
    expect(migration).not.toContain("network = 'mainnet'")
    expect(migration).not.toContain('r5Authorized')
    expect(migration).not.toContain('publicReaderCutover')
  })
})
