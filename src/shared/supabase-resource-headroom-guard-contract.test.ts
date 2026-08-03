import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const guardMigration = read(
  'supabase/migrations/20260803040000_xrpl_resource_headroom_guard.sql',
)
const activationMigration = read(
  'supabase/migrations/20260803040500_xrpl_resource_headroom_activation.sql',
)
const edge = read('supabase/functions/xrpl-resource-headroom-guard/index.ts')
const recorder = read('scripts/record-supabase-external-resource-snapshot.mjs')
const verifier = read('scripts/verify-supabase-resource-headroom-guard.mjs')
const publisher = read('scripts/publish-supabase-resource-run-locator.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')
const config = read('supabase/config.toml')

describe('Supabase R4C2d resource headroom guard contract', () => {
  it('defines conservative halt thresholds below hard provider ceilings', () => {
    for (const required of [
      'v_database_halt constant bigint := 400000000',
      'v_database_hard constant bigint := 500000000',
      'v_connection_halt constant integer := 45',
      'v_connection_hard constant integer := 60',
      'v_edge_wall_halt constant numeric := 45000',
      'v_edge_wall_hard constant numeric := 150000',
      'v_invocation_halt constant bigint := 400000',
      'v_invocation_hard constant bigint := 500000',
      'v_bundle_halt constant bigint := 4000000',
      'v_bundle_hard constant bigint := 5000000',
      "v_external.observed_at >= p_observed_at - interval '25 hours'",
      "'edgeCpu', false",
      "'edgeMemory', false",
      "'bandwidth', false",
      "'billingAndOverage', false",
    ]) {
      expect(guardMigration).toContain(required)
    }
  })

  it('halts before work reservation and preserves active state', () => {
    for (const required of [
      'create or replace function public.xrpl_guard_network_steady_session',
      "status = 'halted'",
      "last_error = left(concat('resource_guard:'",
      'lease_owner = null',
      'lease_expires_at = null',
      'create or replace function xrpl_resource_guard_v1.enforce_completed_tick()',
      "raise exception 'resource_guard_precommit:%'",
      'create or replace function public.xrpl_qualify_resource_guard_fail_closed',
      "p_guard_kind not in ('database', 'connections', 'edge_wall', 'external_snapshot', 'invocations', 'bundle')",
      "v_tick_count <> 0 or v_work_count <> 0 or v_message_count <> 0 or v_successor_count <> 0",
      "'noTickReserved', v_tick_count = 0",
      "'noWorkCommitted', v_work_count = 0",
      "'noMessageReserved', v_message_count = 0",
      "'noSuccessorReserved', v_successor_count = 0",
      "'activeProfileNonRegressing'",
      "'activeSourceIdentityPreserved'",
    ]) {
      expect(guardMigration).toContain(required)
    }
  })

  it('keeps resource enforcement opt-in until live external coverage exists', () => {
    for (const required of [
      'resource_guard_enabled boolean not null default false',
      'where status = \'running\' and resource_guard_enabled',
      'if not coalesce(v_enabled, false) then',
      "when new.resource_guard_enabled then '/functions/v1/xrpl-resource-headroom-guard'",
      "else '/functions/v1/xrpl-steady-batch-tick'",
      'create or replace function public.xrpl_prepare_guarded_network_steady_session',
      "raise exception 'resource guard blocks guarded session:%'",
      "true, 'passed', p_prepared_at",
      "'resourceGuardEnabled', true",
    ]) {
      expect(activationMigration).toContain(required)
    }
  })

  it('provides one service-authenticated cron guard and token-gated qualification surface', () => {
    for (const required of [
      "const PURPOSE = 'r4c2d-resource-headroom-guard'",
      "body.source === 'pg_cron'",
      "request.headers.get('apikey') !== key",
      "'xrpl_guard_network_steady_session'",
      '/functions/v1/xrpl-steady-batch-tick',
      "action === 'read'",
      "'xrpl_read_resource_guard_snapshot'",
      "action === 'record'",
      "'xrpl_record_external_resource_snapshot'",
      "action === 'prepare_guarded'",
      "'xrpl_prepare_guarded_network_steady_session'",
      "action === 'qualify'",
      "'xrpl_qualify_resource_guard_fail_closed'",
      "request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')",
      "request.headers.get(PURPOSE_HEADER) !== PURPOSE",
    ]) {
      expect(edge).toContain(required)
    }
  })

  it('records exact Management API invocation and deployed-function evidence', () => {
    for (const required of [
      'https://api.supabase.com/v1/projects/${projectRef}',
      "managementRequest('/functions')",
      "managementRequest('/analytics/endpoints/logs.all'",
      'SELECT count(*) AS invocation_count',
      'FROM edge_logs',
      'CROSS JOIN UNNEST(metadata) AS metadata',
      "WHERE path LIKE '%/functions/v1/%'",
      'iso_timestamp_start: windowStart',
      'iso_timestamp_end: observedAt',
      'projectedInvocations31d = invocationCount24h * 31',
      'deployed function/bundle identity mismatch',
      "action: 'record'",
      'resource-external-snapshot.json',
      'failed-resource-external-snapshot.json',
      'functionInvocationCoverage: true',
      'bundleSizeCoverage: true',
      'g8Qualified: false',
    ]) {
      expect(recorder).toContain(required)
    }
  })

  it('requires the fresh external snapshot before remote guard qualification', () => {
    for (const required of [
      "await import('./record-supabase-external-resource-snapshot.mjs')",
      "'functionInvocations'",
      "'bundleSize'",
      'measurements.externalSnapshotFresh !== true',
      'projectedInvocations31d >= exactThresholds.invocationHalt31d',
      'maxBundleBytes >= exactThresholds.bundleHaltBytes',
      'bundleCount !== functionCount',
      'invocationCount24h * 31 !== projectedInvocations31d',
      "snapshot.allowed !== true",
      'externalSnapshotFresh: true',
      'functionInvocationCoverage: true',
      'bundleSizeCoverage: true',
      'liveGuardAllowed: true',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('remotely proves all six exact halt paths without overstating G8', () => {
    for (const required of [
      "const purpose = 'r4c2d-resource-headroom-guard'",
      "'database'",
      "'connections'",
      "'edge_wall'",
      "'external_snapshot'",
      "'invocations'",
      "'bundle'",
      'databaseHaltBytes: 400000000',
      'connectionHalt: 45',
      'edgeWallHaltMilliseconds: 45000',
      'invocationHalt31d: 400000',
      'bundleHaltBytes: 4000000',
      "checks.g8Qualified !== false",
      'sixFailClosedThresholdsProved: true',
      'preReservationHaltProved: true',
      'liveProviderCoverageNotOverstated: true',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('deploys through the existing single Supabase workflow', () => {
    expect(config).toContain('[functions.xrpl-resource-headroom-guard]')
    for (const required of [
      "'scripts/verify-supabase-resource-headroom-guard.mjs'",
      "'scripts/publish-supabase-resource-run-locator.mjs'",
      "'supabase/functions/xrpl-resource-headroom-guard/index.ts'",
      'resource-headroom-guard-bundle.json',
      'supabase functions deploy xrpl-resource-headroom-guard',
      'node scripts/verify-supabase-resource-headroom-guard.mjs',
      'verified-resource-headroom-guard.json',
      'failed-resource-headroom-guard-verification.json',
      'resource headroom guard verifier: `success`',
      'node scripts/publish-supabase-resource-run-locator.mjs',
      'gh issue comment 1109',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/supabase secrets set XRPL_READER_VERIFY_TOKEN/g)).toHaveLength(1)
    expect(workflow.match(/gh issue comment 1109/g)).toHaveLength(1)
  })

  it('publishes only sanitized external and guard evidence', () => {
    for (const required of [
      'resource-external-snapshot.json',
      'failed-resource-external-snapshot.json',
      'external resource snapshot',
      'Management API available',
      'Edge invocations 24h',
      'projected Edge invocations 31d',
      'maximum bundle bytes',
      'verified-resource-headroom-guard.json',
      'failed-resource-headroom-guard-verification.json',
      'resource headroom guard verifier',
      'external snapshot fresh',
      'function invocation coverage',
      'bundle size coverage',
      'six fail-closed thresholds proved',
      'pre-reservation halt proved',
      'active profile read only',
      'G8 qualified',
      'profile selected',
    ]) {
      expect(publisher).toContain(required)
    }
  })
})