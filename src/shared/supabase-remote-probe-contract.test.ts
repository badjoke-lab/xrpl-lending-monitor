import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('R4C2 Supabase remote portable collector contract', () => {
  const probeMigration = read(
    'supabase/migrations/20260802002000_xrpl_remote_collector_probe.sql',
  )
  const phaseMigration = read(
    'supabase/migrations/20260802095000_xrpl_remote_portable_phase_chain.sql',
  )
  const phaseIdentityMigration = read(
    'supabase/migrations/20260802095100_xrpl_remote_phase_message_identity.sql',
  )
  const sevenClassMigration = read(
    'supabase/migrations/20260802104000_xrpl_remote_seven_class_payload.sql',
  )
  const edgeFunction = read('supabase/functions/xrpl-collector-tick/index.ts')
  const normalization = read('src/shared/portable-collector-xrpl-normalization.ts')
  const verifier = read('scripts/verify-supabase-remote-probe.mjs')
  const workflow = read('.github/workflows/supabase-remote-probe.yml')
  const config = read('supabase/config.toml')
  const setup = read('docs/ops/supabase-one-time-setup-2026-08-02.md')

  it('keeps the remote runtime Devnet-only and fail-closed', () => {
    expect(edgeFunction).toContain('https://s.devnet.rippletest.net:51234/')
    expect(edgeFunction).toContain("const PHASE_EPOCH_ID = 'supabase-r4c2c-v1'")
    expect(edgeFunction).toContain("request.headers.get('apikey') !== secretKey")
    expect(edgeFunction).toContain("request.method === 'GET'")
    expect(edgeFunction).toContain("request.method !== 'POST'")
    expect(edgeFunction).toContain('AbortSignal.timeout(8_000)')
    expect(edgeFunction).toContain("message.network !== 'devnet'")
    expect(edgeFunction).toContain('message.epochId !== PHASE_EPOCH_ID')
    expect(edgeFunction).not.toContain('xrplcluster.com')
    expect(edgeFunction).not.toContain('MAINNET')
  })

  it('binds Cron, Vault, RLS, and the transactional tick lease', () => {
    for (const required of [
      'create extension if not exists pg_cron',
      'create extension if not exists pg_net with schema extensions',
      'create extension if not exists supabase_vault with schema vault',
      'alter table public.xrpl_collector_runtime enable row level security',
      'alter table public.xrpl_collector_runs enable row level security',
      'xrpl_claim_collector_tick',
      'xrpl_complete_collector_tick',
      'xrpl_fail_collector_tick',
      "'xrpl_project_url'",
      "'xrpl_secret_key'",
      "'xrpl-lending-monitor-minute'",
      "'* * * * *'",
      'timeout_milliseconds := 10000',
      "grant execute on function public.xrpl_claim_collector_tick",
    ]) {
      expect(probeMigration).toContain(required)
    }
    expect(probeMigration).not.toContain('YOUR_PROJECT_SECRET_KEY')
    expect(probeMigration).not.toContain('service_role key')
  })

  it('retains the R4C2b durable scheduler and committed-only storage boundary', () => {
    for (const required of [
      'create table if not exists public.xrpl_phase_streams',
      'create table if not exists public.xrpl_phase_messages',
      'create table if not exists public.xrpl_phase_successors',
      'create table if not exists public.xrpl_phase_work',
      'create table if not exists public.xrpl_phase_payload_chunks',
      'create table if not exists public.xrpl_phase_reference_rows',
      'create table if not exists public.xrpl_phase_commit_chunks',
      'create table if not exists public.xrpl_phase_watermarks',
      'create or replace view public.xrpl_phase_committed_reference_rows',
      "where work.status = 'committed'",
      "status in ('pending', 'leased', 'retry', 'completed', 'error')",
      "status in ('planned', 'staged', 'committing', 'finalizing', 'committed', 'error')",
      'alter table public.xrpl_phase_messages enable row level security',
      'revoke all on public.xrpl_phase_messages from anon, authenticated',
      'grant select, insert, update on public.xrpl_phase_messages to service_role',
    ]) {
      expect(phaseMigration).toContain(required)
    }
  })

  it('keeps claim, stale reclaim, retry, terminal halt, and successor reservation transactional', () => {
    for (const required of [
      'create or replace function public.xrpl_claim_next_phase',
      'for update skip locked',
      "status = 'leased' and lease_expires_at <= p_now",
      'attempt_count = attempt_count + 1',
      'create or replace function public.xrpl_phase_reserve_successor',
      'phase successor identity conflict',
      'create or replace function public.xrpl_retry_phase_message',
      "p_classification not in ('retryable_transport', 'retryable_storage')",
      "status = 'retry'",
      'create or replace function public.xrpl_fail_phase_terminal',
      "status = 'halted'",
    ]) {
      expect(phaseMigration).toContain(required)
    }
  })

  it('uses portable-compatible deterministic message and work identities', () => {
    expect(phaseMigration).toContain("'scan:v1:'")
    expect(phaseMigration).toContain("'collector-work-v1:'")
    expect(phaseIdentityMigration).toContain("replace(p_work_id, ':', '%3A')")
    expect(phaseIdentityMigration).toContain("'commit:v1:'")
    expect(phaseIdentityMigration).toContain("'finalize:v1:'")
    expect(edgeFunction).toContain('buildPortableCollectorWorkId')
    expect(edgeFunction).toContain('encodeURIComponent(workId)')
    expect(edgeFunction).toContain('scan message ID does not match semantic identity')
    expect(edgeFunction).toContain('commit message ID does not match semantic identity')
    expect(edgeFunction).toContain('finalize message ID does not match semantic identity')
  })

  it('reuses the existing XRPL and portable normalization stack for all seven classes', () => {
    for (const required of [
      "from '../collector/history-segments/build-segment-records'",
      'buildHistorySegmentRecords',
      'buildNormalizedCollectorPayload',
      'buildNormalizedPayloadChunks',
      "semanticClass: 'validated-ledger'",
      "semanticClass: 'protocol-event'",
      "semanticClass: 'object-change'",
      "semanticClass: 'loan-lifecycle'",
      "semanticClass: 'archived-object'",
      "semanticClass: 'balance-history'",
      "semanticClass: 'current-projection'",
      'coalescedProjectionCandidates',
      'portableReferenceRowsFromChunk',
    ]) {
      expect(normalization).toContain(required)
    }
    expect(edgeFunction).toContain('parseValidatedLedgerResult')
    expect(edgeFunction).toContain('isLendingTransactionType')
    expect(edgeFunction).toContain('buildPortableXrplNormalizedWork')
    expect(edgeFunction).toContain('decodeAndVerifyNormalizedPayloadChunk')
    expect(edgeFunction).toContain('portableReferenceRowsFromChunk')
    expect(edgeFunction).toContain('transactions: true')
    expect(edgeFunction).toContain('expand: true')
    expect(edgeFunction).not.toContain("transactions: false")
  })

  it('persists bounded chunks and defers committed candidate insertion to commit phases', () => {
    for (const semanticClass of [
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'balance-history',
      'current-projection',
    ]) {
      expect(sevenClassMigration).toContain(`'${semanticClass}'`)
    }
    for (const required of [
      'create or replace function public.xrpl_complete_portable_scan_phase',
      'create or replace function public.xrpl_complete_portable_commit_phase',
      'create or replace function public.xrpl_complete_portable_finalize_phase',
      'v_record_count < 1 or v_record_count > 40',
      "octet_length(v_chunk_payload_json) > 512000",
      'portable payload chunks are not contiguous',
      'portable reference-row does not match payload chunk',
      'portable commit chunks are out of order',
      'portable commit evidence is incomplete',
      'portable reference-row evidence is incomplete',
      "epoch_id = 'supabase-r4c2c-v1'",
      "error_classification = 'superseded_epoch'",
    ]) {
      expect(sevenClassMigration).toContain(required)
    }

    const scanStart = sevenClassMigration.indexOf(
      'create or replace function public.xrpl_complete_portable_scan_phase',
    )
    const commitStart = sevenClassMigration.indexOf(
      'create or replace function public.xrpl_complete_portable_commit_phase',
    )
    const finalizeStart = sevenClassMigration.indexOf(
      'create or replace function public.xrpl_complete_portable_finalize_phase',
    )
    const scanSql = sevenClassMigration.slice(scanStart, commitStart)
    const commitSql = sevenClassMigration.slice(commitStart, finalizeStart)
    expect(scanSql).not.toContain('insert into public.xrpl_phase_reference_rows')
    expect(commitSql).toContain('insert into public.xrpl_phase_reference_rows')
    expect(commitSql).toContain('v_payload_record')
  })

  it('executes one durable phase per Cron tick through the R4C2c RPCs', () => {
    for (const required of [
      "'xrpl_claim_next_phase'",
      "'xrpl_complete_caught_up_scan'",
      "'xrpl_complete_portable_scan_phase'",
      "'xrpl_complete_portable_commit_phase'",
      "'xrpl_complete_portable_finalize_phase'",
      "'xrpl_retry_phase_message'",
      "'xrpl_fail_phase_terminal'",
      "rpcRequest(endpoint, 'server_info'",
      "rpcRequest(endpoint, 'ledger'",
      'message.expectedPreviousLedgerIndex + 1',
      'ledger.parentHash !== message.expectedPreviousLedgerHash',
      'canonicalPortableJson(chunks)',
      'p_reference_rows_digest: await sha256Hex(referenceRowsJson)',
    ]) {
      expect(edgeFunction).toContain(required)
    }
  })

  it('requires remote multi-chunk, semantic-count, committed-row, watermark, and successor parity', () => {
    for (const required of [
      'const maximumAttempts = 48',
      'schemaVersion: 3',
      "const phaseEpochId = 'supabase-r4c2c-v1'",
      "requiredPhases: ['scan', 'commit', 'finalize']",
      'orderedMultiChunkCommits: true',
      'sevenClassEnvelope: true',
      'committedOnlyVisibility: true',
      'semanticCountParity: true',
      'successorContinuation: true',
      'committed-only row count does not match semantic counts',
      'semantic count mismatch for',
      'current-projection tombstone exposes a value',
      'scan, ordered commits, finalize, and successor chain is not complete yet',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('publishes only a sanitized workflow run locator to the retained issue ledger', () => {
    for (const required of [
      'issues: write',
      'Publish sanitized run locator',
      'supabase-remote-probe-evidence/verified-health.json',
      'supabase-remote-probe-evidence/failed-verification.json',
      'gh issue comment 1109',
      'phase watermark ledger',
      'consecutive failures',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow).not.toContain('echo "$SUPABASE_ACCESS_TOKEN"')
    expect(workflow).not.toContain('echo "$SUPABASE_DB_PASSWORD"')
  })

  it('documents the cardless handoff and automated deployment boundary', () => {
    expect(config).toContain('[functions.xrpl-collector-tick]')
    expect(config).toContain('verify_jwt = false')
    for (const required of [
      'Free organization and Free project only',
      'Do not add a payment method',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_PROJECT_ID',
      'SUPABASE_DB_PASSWORD',
      'working directory: `.`',
      'deploy to production: enabled',
      'production branch: `main`',
      'automatic branching: disabled',
      'xrpl_project_url',
      'xrpl_secret_key',
      'No Supabase dashboard interaction should be needed',
    ]) {
      expect(setup).toContain(required)
    }
    expect(setup).not.toContain('Supabase directory: `supabase`')
  })
})
