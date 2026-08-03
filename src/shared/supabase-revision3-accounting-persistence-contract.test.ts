import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const baseMigration = read(
  'supabase/migrations/20260803100000_xrpl_revision3_resource_accounting.sql',
)
const attemptMigration = read(
  'supabase/migrations/20260803100500_xrpl_revision3_accounting_attempts.sql',
)
const executor = read('supabase/functions/xrpl-steady-batch-tick/index.ts')

describe('Supabase revision-3 accounting persistence contract', () => {
  it('retains safe and unsafe accounting attempts in the rolling egress window', () => {
    for (const required of [
      'create schema if not exists xrpl_resource_guard_v2',
      'create table if not exists xrpl_resource_guard_v2.tick_accounting',
      'allowed boolean not null',
      'conservative_tick_egress_upper_bound_bytes bigint not null',
      'sum(conservative_tick_egress_upper_bound_bytes)',
      "recorded_at >= p_observed_at - interval '31 days'",
      "'failedAttemptsIncludedInRollingEgress', true",
    ]) {
      expect(baseMigration).toContain(required)
    }
    expect(baseMigration).not.toContain('where allowed\n')
    expect(baseMigration).not.toContain('allowed boolean not null check (allowed)')
  })

  it('stores multiple attempts per tick and keeps exact replay convergence', () => {
    for (const required of [
      'add primary key (session_id, tick_id, accounting_digest)',
      'on conflict (session_id, tick_id, accounting_digest) do nothing',
      'and accounting_digest = p_accounting_digest',
      "raise exception 'revision-3 accounting replay conflicts with retained evidence'",
      "'attemptCount'",
      'order by recorded_at desc, created_at desc',
    ]) {
      expect(attemptMigration).toContain(required)
    }
  })

  it('binds accounting context to the exact leased tick and guarded-session mode', () => {
    for (const required of [
      'create or replace function public.xrpl_read_revision3_accounting_context',
      "v_tick.status <> 'leased'",
      'v_tick.lease_owner is distinct from p_owner',
      'v_tick.lease_expires_at <= p_observed_at',
      'select resource_guard_enabled into v_required',
      "'required', coalesce(v_required, false)",
      "'guardedSessionRequiresAccounting', coalesce(v_required, false)",
      "'unguardedQualificationPreserved', not coalesce(v_required, false)",
      "'3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'",
    ]) {
      expect(attemptMigration).toContain(required)
    }
  })

  it('requires safe revision-3 evidence before a guarded completion only', () => {
    for (const required of [
      'create or replace function xrpl_resource_guard_v2.enforce_completed_tick()',
      "new.status <> 'completed'",
      'select resource_guard_enabled into v_enabled',
      'if not coalesce(v_enabled, false) then',
      'where session_id = new.session_id and tick_id = new.tick_id',
      'order by recorded_at desc, created_at desc',
      'or not v_accounting.allowed',
      'or v_accounting.profile_revision <> 3',
      "raise exception 'revision3_resource_accounting_precommit'",
      'before update on xrpl_steady_v1.ticks',
    ]) {
      expect(attemptMigration).toContain(required)
    }
  })

  it('meters every visible network direction and bounds response materialization', () => {
    for (const required of [
      'networkRequestCount: number',
      'networkRequestBytes: number',
      'networkResponseBytes: number',
      'databaseRequestCount: number',
      'databaseRequestBytes: number',
      'databaseResponseBytes: number',
      "addMeterValue(meter, 'networkRequestBytes', byteLength(bodyText))",
      "addMeterValue(meter, 'networkResponseBytes', byteLength(text))",
      "addMeterValue(meter, 'databaseRequestBytes', byteLength(bodyText))",
      "addMeterValue(meter, 'databaseResponseBytes', byteLength(text))",
      'boundedResponseText',
      'const FETCH_CONCURRENCY = 2',
      'const MAX_LEDGER_RESPONSE_BYTES = 1024 * 1024',
    ]) {
      expect(executor).toContain(required)
    }
  })

  it('counts ledger fan-out and applies conservative planned request reserves', () => {
    for (const required of [
      'transactionCount: ledgers.reduce',
      'metadataNodeCount: metadataNodeCount(ledgers)',
      'normalizedRecordCount: builtWorks.reduce',
      'payloadChunkCount: builtWorks.reduce',
      'relationshipCount: builtWorks.reduce',
      'canonicalJsonBytes: byteLength(worksJson)',
      'payloadBytes: builtWorks.reduce',
      'ACCOUNTING_RECORD_REQUEST_RESERVE_BYTES',
      'FAILURE_REQUEST_RESERVE_BYTES',
      'FUNCTION_RESPONSE_RESERVE_BYTES',
      'responseBytes: 4 * MAX_DATABASE_RESPONSE_BYTES',
    ]) {
      expect(executor).toContain(required)
    }
  })

  it('persists the accounting decision before memory and atomic completion', () => {
    const evaluateAt = executor.indexOf('evaluateSupabaseRevision3ResourceAccounting(input)')
    const recordAt = executor.indexOf('recordRevision3Accounting({')
    const unsafeHaltAt = executor.indexOf('revision3_resource_halt:')
    const memoryAt = executor.indexOf("'xrpl_record_network_steady_memory'")
    const completionAt = executor.indexOf("'xrpl_complete_network_steady_tick'")

    expect(evaluateAt).toBeGreaterThan(0)
    expect(recordAt).toBeGreaterThan(evaluateAt)
    expect(unsafeHaltAt).toBeGreaterThan(recordAt)
    expect(memoryAt).toBeGreaterThan(unsafeHaltAt)
    expect(completionAt).toBeGreaterThan(memoryAt)
    expect(executor).toContain('failedAttemptRetainedBeforeHalt: true')
    expect(executor).toContain('accountingRecordedBeforeCollectorCompletion: true')
  })

  it('never reclassifies unavailable provider counters as measured evidence', () => {
    for (const required of [
      'unavailableProviderMemoryNotClaimed',
      'unavailableProviderEgressNotClaimed',
      'SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST',
      "'xrpl_record_revision3_tick_accounting'",
      "'xrpl_read_revision3_accounting_context'",
    ]) {
      expect(executor).toContain(required)
    }
    expect(executor).not.toContain('providerEgressBytesAvailable: true')
    expect(executor).not.toContain('exactPeakEdgeMemoryAvailable: true')
  })
})
