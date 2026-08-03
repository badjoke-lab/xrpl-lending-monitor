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

describe('Supabase revision-3 remote accounting qualification contract', () => {
  it('reads one latest accounting row for every completed guarded tick', () => {
    for (const required of [
      'create or replace function public.xrpl_read_revision3_session_accounting',
      'select distinct on (tick_id)',
      'order by tick_id, recorded_at desc, created_at desc',
      "'latestAccountings'",
      "'attemptCount'",
      "'allowedAttemptCount'",
      "'unsafeAttemptCount'",
      "'oneLatestAccountingPerCompletedTick'",
      "'allLatestAllowed'",
      "'allBelowThresholds'",
      "'allRecordedBeforeCompletion'",
      "'providerPeakMemoryClaimed', false",
      "'providerEgressClaimed', false",
      "'activeProfileReadOnly', true",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('injects every revision-3 precommit failure without collector mutation', () => {
    for (const required of [
      'create or replace function public.xrpl_qualify_revision3_accounting_precommit',
      "'missing_accounting'",
      "'unsafe_accounting'",
      "'memory_halt'",
      "'tick_egress_halt'",
      "'monthly_egress_halt'",
      "'invocation_halt'",
      "'future_record'",
      "position('revision3_resource_accounting_precommit' in sqlerrm) > 0",
      "'ticks', count(*) filter (where status = 'completed')",
      "'works', (select count(*) from xrpl_steady_v1.works",
      "'messages', (select count(*) from xrpl_steady_v1.messages",
      "'successors', (select count(*) from xrpl_steady_v1.successors",
      "'precommitRejected'",
      "'noCompletedTick'",
      "'noWorkCommitted'",
      "'noMessageReserved'",
      "'noSuccessorReserved'",
      "'activeProfileReadOnly'",
      'delete from xrpl_steady_v1.sessions where session_id = v_session_id',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('exposes revision-3 accounting beside the existing steady read', () => {
    for (const required of [
      'const [session, memory, revision3Accounting] = await Promise.all',
      "rpc<JsonObject>('xrpl_read_revision3_session_accounting'",
      'revision3Accounting,',
      "request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')",
      "request.headers.get(PURPOSE_HEADER) !== PURPOSE",
    ]) {
      expect(steadyReader).toContain(required)
    }
  })

  it('exposes all seven injected guards through the existing resource function', () => {
    for (const required of [
      'const REVISION3_GUARD_KINDS = [',
      "'missing_accounting'",
      "'future_record'",
      "action === 'qualify_revision3'",
      "'xrpl_qualify_revision3_accounting_precommit'",
      'verifyRevision3QualificationResult',
      'allSevenRevision3GuardsRejected',
      'unavailableProviderMemoryNotClaimed',
      'unavailableProviderEgressNotClaimed',
      'g8Qualified: false',
      'profileSelected: false',
    ]) {
      expect(resourceGuard).toContain(required)
    }
  })

  it('runs a real guarded 6x24 session and verifies every conservative bound', () => {
    for (const required of [
      "{ action: 'prepare_guarded', sessionId }",
      "{ action: 'read', sessionId }",
      "latest.status === 'completed'",
      "latest.status === 'halted'",
      'session.completedTicks !== 6',
      'session.committedLedgers !== 144',
      'completed.length !== 6',
      'tick.workCount !== 24',
      'current - previous !== 60_000',
      'accounting.latestAccountingCount !== 6',
      'accounting.accountedCompletedTickCount !== 6',
      'item.conservativeMemoryUpperBoundBytes',
      'item.conservativeTickEgressUpperBoundBytes',
      'item.conservativeEgress31dUpperBoundBytes',
      'item.projectedInvocations31d',
      'unavailableProviderMemoryNotClaimed',
      'unavailableProviderEgressNotClaimed',
      "{ action: 'qualify_revision3', qualificationId }",
      'allSevenInjectedPrecommitFailuresRejected: true',
      'g8Qualified: false',
      'profileSelected: false',
      'r5Authorized: false',
      'verified-revision3-accounting.json',
      'failed-revision3-accounting-verification.json',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('chains revision-3 qualification after the existing resource verifier', () => {
    const resourceRun = resourceVerifier.indexOf('await run()')
    const revision3 = resourceVerifier.indexOf(
      "await import('./verify-supabase-revision3-accounting.mjs')",
    )
    const operator = resourceVerifier.indexOf(
      "await import('./verify-supabase-operator-independence.mjs')",
    )
    expect(resourceRun).toBeGreaterThan(0)
    expect(revision3).toBeGreaterThan(resourceRun)
    expect(operator).toBeGreaterThan(revision3)
  })

  it('publishes sanitized revision-3 evidence before later run locators', () => {
    for (const required of [
      'verified-revision3-accounting.json',
      'failed-revision3-accounting-verification.json',
      'R4C3 revision-3 application-owned resource accounting',
      'conservative memory bounds',
      'conservative tick egress bounds',
      'all seven injected failures rejected',
      'provider peak memory claimed',
      'provider egress claimed',
      'R5 authorized',
    ]) {
      expect(publisher).toContain(required)
    }
    const revision3 = operatorPublisher.indexOf(
      "await import('./publish-supabase-revision3-run-locator.mjs')",
    )
    const provider = operatorPublisher.indexOf(
      "await import('./publish-supabase-provider-metric-capability.mjs')",
    )
    expect(revision3).toBeGreaterThan(0)
    expect(provider).toBeGreaterThan(revision3)
  })
})
