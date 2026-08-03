import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803102000_xrpl_revision3_accounting_qualification.sql',
)
const steadyReader = read(
  'supabase/functions/xrpl-steady-throughput-qualification/index.ts',
)
const resourceGuard = read(
  'supabase/functions/xrpl-resource-headroom-guard/index.ts',
)
const verifier = read('scripts/verify-supabase-revision3-accounting.mjs')
const resourceVerifier = read('scripts/verify-supabase-resource-headroom-guard.mjs')
const publisher = read('scripts/publish-supabase-revision3-run-locator.mjs')
const operatorPublisher = read('scripts/publish-supabase-operator-run-locator.mjs')

const revision3Identity =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
const revision3Guards = [
  'missing_accounting',
  'unsafe_accounting',
  'memory_halt',
  'tick_egress_halt',
  'monthly_egress_halt',
  'invocation_halt',
  'future_record',
]

describe('Supabase revision-3 remote accounting qualification contract', () => {
  it('binds the exact guarded accounting reader and profile identity', () => {
    expect(migration).toContain(
      'create or replace function public.xrpl_read_revision3_session_accounting',
    )
    expect(migration).toContain('select distinct on (tick_id)')
    expect(migration).toContain('order by tick_id, recorded_at desc, created_at desc')
    expect(migration).toContain(revision3Identity)
    for (const check of [
      'oneLatestAccountingPerCompletedTick',
      'allLatestAllowed',
      'allBelowThresholds',
      'allRecordedBeforeCompletion',
      'providerPeakMemoryClaimed',
      'providerEgressClaimed',
      'activeProfileReadOnly',
    ]) expect(migration).toContain(check)
  })

  it('injects every revision-3 precommit failure and requires zero mutation', () => {
    expect(migration).toContain(
      'create or replace function public.xrpl_qualify_revision3_accounting_precommit',
    )
    for (const guard of revision3Guards) expect(migration).toContain(`'${guard}'`)
    expect(migration).toContain('revision3_resource_accounting_precommit')
    for (const check of [
      'precommitRejected',
      'noCompletedTick',
      'noWorkCommitted',
      'noMessageReserved',
      'noSuccessorReserved',
      'activeProfileReadOnly',
    ]) expect(migration).toContain(check)
    expect(migration).toContain(
      'delete from xrpl_steady_v1.sessions where session_id = v_session_id',
    )
  })

  it('returns revision-3 accounting through the existing token-gated steady reader', () => {
    expect(steadyReader).toContain('revision3Accounting')
    expect(steadyReader).toContain('xrpl_read_revision3_session_accounting')
    expect(steadyReader).toContain('XRPL_READER_VERIFY_TOKEN')
    expect(steadyReader).toContain('invalid_purpose')
  })

  it('exposes the seven injections through the existing resource guard function', () => {
    expect(resourceGuard).toContain('REVISION3_GUARD_KINDS')
    expect(resourceGuard).toContain("action === 'qualify_revision3'")
    expect(resourceGuard).toContain('xrpl_qualify_revision3_accounting_precommit')
    expect(resourceGuard).toContain('verifyRevision3QualificationResult')
    expect(resourceGuard).toContain(revision3Identity)
    for (const guard of revision3Guards) expect(resourceGuard).toContain(`'${guard}'`)
    expect(resourceGuard).toContain('allSevenRevision3GuardsRejected')
    expect(resourceGuard).toContain('g8Qualified: false')
    expect(resourceGuard).toContain('profileSelected: false')
  })

  it('verifies a real guarded six-minute 144-ledger session without overclaiming G8', () => {
    for (const required of [
      "action: 'prepare_guarded'",
      "action: 'read'",
      "action: 'qualify_revision3'",
      'completedTicks !== 6',
      'committedLedgers !== 144',
      'workCount !== 24',
      'latestAccountingCount !== 6',
      'accountedCompletedTickCount !== 6',
      'conservativeMemoryUpperBoundBytes',
      'conservativeTickEgressUpperBoundBytes',
      'conservativeEgress31dUpperBoundBytes',
      'projectedInvocations31d',
      'allSevenInjectedPrecommitFailuresRejected: true',
      'unavailableProviderMemoryNotClaimed: true',
      'unavailableProviderEgressNotClaimed: true',
      'g8Qualified: false',
      'profileSelected: false',
      'r5Authorized: false',
      'verified-revision3-accounting.json',
      'failed-revision3-accounting-verification.json',
    ]) expect(verifier).toContain(required)
    expect(verifier).toContain(revision3Identity)
  })

  it('chains qualification and sanitized publication through the existing workflow path', () => {
    const revision3Verifier = resourceVerifier.indexOf(
      "await import('./verify-supabase-revision3-accounting.mjs')",
    )
    const operatorVerifier = resourceVerifier.indexOf(
      "await import('./verify-supabase-operator-independence.mjs')",
    )
    expect(revision3Verifier).toBeGreaterThan(0)
    expect(operatorVerifier).toBeGreaterThan(revision3Verifier)

    for (const required of [
      'verified-revision3-accounting.json',
      'failed-revision3-accounting-verification.json',
      'R4C3 revision-3 application-owned resource accounting',
      'conservative memory bounds',
      'conservative tick egress bounds',
      'all seven injected failures rejected',
      'R5 authorized',
    ]) expect(publisher).toContain(required)

    const revision3Publisher = operatorPublisher.indexOf(
      "await import('./publish-supabase-revision3-run-locator.mjs')",
    )
    const providerPublisher = operatorPublisher.indexOf(
      "await import('./publish-supabase-provider-metric-capability.mjs')",
    )
    expect(revision3Publisher).toBeGreaterThan(0)
    expect(providerPublisher).toBeGreaterThan(revision3Publisher)
  })
})
