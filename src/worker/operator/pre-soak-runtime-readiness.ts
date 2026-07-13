import type { CatchUpBaseIdentity } from '../../shared/catch-up-base-identity'
import type { FastLaneShadowDiffEvidence } from '../repositories/fast-lane-shadow-diff'
import { readFastLaneShadowBaseBinding } from '../repositories/fast-lane-shadow-base-binding'
import { readFastLaneShadowDiff } from '../repositories/fast-lane-shadow-diff'
import { readFastLaneShadowState } from '../repositories/fast-lane-shadow-repository'
import { getIncrementalCollectorState, type IncrementalCollectorState } from '../repositories/incremental-collector-state'

const FAST_LANE_SHADOW_EPOCH_ID = 'fast-lane-shadow-devnet'
const FAST_LANE_MAX_LAG_LEDGERS = 10
const FAST_LANE_MAX_AGE_SECONDS = 10 * 60
const PROTECTED_COLLECTOR_MAX_AGE_SECONDS = 5 * 60 * 60
const REQUIRED_RECENT_RUNS = 3

export interface PreSoakHistoryEvidence {
  status: 'ok' | 'unavailable'
  mode: 'hybrid' | 'd1'
  epochId: string | null
  ledgerIndex: number | null
  ledgerHash: string | null
  exactIndexConfigured: boolean
}

export interface PreSoakRunEvidence {
  runAt: string
  status: 'caught_up' | 'committed' | 'reanchored' | 'error'
}

export interface PreSoakRuntimeEvidence {
  network: string | undefined
  mainnetEnabled: string | undefined
  expectedBase: CatchUpBaseIdentity | null
  history: PreSoakHistoryEvidence
  replacementBaseDryRunPassed: boolean
  binding: Awaited<ReturnType<typeof readFastLaneShadowBaseBinding>>
  fastLane: Awaited<ReturnType<typeof readFastLaneShadowState>>
  diff: FastLaneShadowDiffEvidence
  protectedCollector: IncrementalCollectorState | null
  recentRuns: PreSoakRunEvidence[]
}

export interface PreSoakReadinessCheck {
  passed: boolean
  reason: string
}

export interface PreSoakRuntimeReadinessReport {
  schemaVersion: 1
  architecture: 'rolling_checkpoint_fast_lane_v1'
  supersedes: string[]
  passed: boolean
  checks: {
    devnetBoundary: PreSoakReadinessCheck
    productionBase: PreSoakReadinessCheck
    immutableHistory: PreSoakReadinessCheck
    replacementBase: PreSoakReadinessCheck
    fastLaneBinding: PreSoakReadinessCheck
    fastLaneState: PreSoakReadinessCheck
    fastLaneFreshness: PreSoakReadinessCheck
    projectionParity: PreSoakReadinessCheck
    recentFiveMinuteRuns: PreSoakReadinessCheck
    protectedCollector: PreSoakReadinessCheck
  }
  evidence: PreSoakRuntimeEvidence
}

function check(passed: boolean, success: string, failure: string): PreSoakReadinessCheck {
  return { passed, reason: passed ? success : failure }
}

function parsedAgeSeconds(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 1000) : null
}

function sameBase(
  left: CatchUpBaseIdentity | null | undefined,
  right: CatchUpBaseIdentity | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.epochId === right.epochId
    && left.snapshotId === right.snapshotId
    && left.ledgerIndex === right.ledgerIndex
    && left.ledgerHash === right.ledgerHash,
  )
}

export function evaluatePreSoakRuntimeReadiness(
  evidence: PreSoakRuntimeEvidence,
  nowMs = Date.now(),
): PreSoakRuntimeReadinessReport {
  const expectedBase = evidence.expectedBase
  const binding = evidence.binding
  const fastLane = evidence.fastLane
  const fastLaneLag = fastLane
    ? Math.max(0, fastLane.latestObservedLedger - fastLane.lastProcessedLedger)
    : null
  const fastLaneAge = parsedAgeSeconds(fastLane?.updatedAt, nowMs)
  const collectorAge = parsedAgeSeconds(evidence.protectedCollector?.lastSuccessAt, nowMs)
  const latestRuns = evidence.recentRuns.slice(0, REQUIRED_RECENT_RUNS)
  const latestRunAge = parsedAgeSeconds(latestRuns[0]?.runAt, nowMs)
  const paritySample = evidence.diff.sample
  const canonicalComparisonRows = paritySample
    ? Math.max(0, paritySample.sampledRows - paritySample.canonicalMissingRows)
    : 0

  const checks = {
    devnetBoundary: check(
      evidence.network === 'devnet' && evidence.mainnetEnabled === 'false',
      'runtime is Devnet-only and Mainnet is disabled',
      'runtime network boundary is not Devnet-only',
    ),
    productionBase: check(
      expectedBase !== null,
      'production replacement base is configured',
      'production replacement base is unavailable',
    ),
    immutableHistory: check(
      Boolean(
        expectedBase
        && evidence.history.status === 'ok'
        && evidence.history.mode === 'hybrid'
        && evidence.history.exactIndexConfigured
        && evidence.history.epochId === expectedBase.epochId
        && evidence.history.ledgerIndex === expectedBase.ledgerIndex
        && evidence.history.ledgerHash === expectedBase.ledgerHash,
      ),
      'immutable history and exact index match the production base',
      'immutable history or exact index does not match the production base',
    ),
    replacementBase: check(
      evidence.replacementBaseDryRunPassed,
      'replacement-base dry run is replay-safe',
      'replacement-base dry run is unavailable or inconsistent',
    ),
    fastLaneBinding: check(
      Boolean(
        expectedBase
        && binding
        && binding.shadowEpochId === FAST_LANE_SHADOW_EPOCH_ID
        && sameBase(binding.base, expectedBase),
      ),
      'five-minute fast lane is bound to the production base',
      'five-minute fast-lane binding does not match the production base',
    ),
    fastLaneState: check(
      Boolean(
        expectedBase
        && binding
        && fastLane
        && fastLane.epochId === binding.shadowEpochId
        && fastLane.status !== 'error'
        && fastLane.lastProcessedLedger >= expectedBase.ledgerIndex,
      ),
      'five-minute fast-lane state is valid and at or beyond the base',
      'five-minute fast-lane state is unavailable, errored, or behind the base',
    ),
    fastLaneFreshness: check(
      fastLaneLag !== null
        && fastLaneLag <= FAST_LANE_MAX_LAG_LEDGERS
        && fastLaneAge !== null
        && fastLaneAge <= FAST_LANE_MAX_AGE_SECONDS,
      'five-minute current state is within 10 ledgers and 10 minutes',
      'five-minute current state has not reached the freshness gate',
    ),
    projectionParity: check(
      evidence.diff.status === 'ok'
        && evidence.diff.passed
        && Boolean(paritySample)
        && Number(paritySample?.sampledRows ?? 0) > 0
        && canonicalComparisonRows > 0
        && Number(paritySample?.exactSourceMatches ?? 0) > 0
        && Number(paritySample?.exactProjectionMatches ?? 0) === Number(paritySample?.exactSourceMatches ?? 0)
        && Number(paritySample?.exactProjectionMismatches ?? 0) === 0,
      'fast-lane and canonical projections have a non-empty exact comparison with zero mismatches',
      'fast-lane projection parity is unavailable, empty, incomplete, or mismatched',
    ),
    recentFiveMinuteRuns: check(
      latestRuns.length === REQUIRED_RECENT_RUNS
        && latestRuns.every((run) => run.status !== 'error')
        && latestRunAge !== null
        && latestRunAge <= FAST_LANE_MAX_AGE_SECONDS,
      'three recent five-minute runs completed without errors',
      'recent five-minute run evidence is missing, stale, or errored',
    ),
    protectedCollector: check(
      Boolean(
        evidence.protectedCollector
        && evidence.protectedCollector.consecutiveFailures === 0
        && evidence.protectedCollector.errorCode === null
        && evidence.protectedCollector.errorMessage === null
        && evidence.protectedCollector.status !== 'error'
        && evidence.protectedCollector.status !== 'reset_suspected'
        && collectorAge !== null
        && collectorAge <= PROTECTED_COLLECTOR_MAX_AGE_SECONDS,
      ),
      'protected four-hour collector has a recent successful run and no failures',
      'protected four-hour collector is stale, errored, or has failures',
    ),
  }

  return {
    schemaVersion: 1,
    architecture: 'rolling_checkpoint_fast_lane_v1',
    supersedes: [
      '/api/status/continuation-verification',
      '/api/status/m1-exit',
    ],
    passed: Object.values(checks).every((item) => item.passed),
    checks,
    evidence,
  }
}

interface RunRow {
  run_at: string
  status: PreSoakRunEvidence['status']
}

export async function reviewPreSoakRuntimeReadiness(options: {
  db: D1Database
  network: string | undefined
  mainnetEnabled: string | undefined
  expectedBase: CatchUpBaseIdentity | null
  history: PreSoakHistoryEvidence
  replacementBaseDryRunPassed: boolean
  nowMs?: number
}): Promise<PreSoakRuntimeReadinessReport> {
  const [binding, fastLane, diff, protectedCollector, runResponse] = await Promise.all([
    readFastLaneShadowBaseBinding(options.db),
    readFastLaneShadowState(options.db),
    readFastLaneShadowDiff({ db: options.db, sampleLimit: 500 }),
    getIncrementalCollectorState(options.db),
    options.db.prepare(
      `SELECT run_at, status
       FROM fast_lane_shadow_run_metrics
       WHERE network = 'devnet'
       ORDER BY run_at DESC
       LIMIT 3`,
    ).all<RunRow>(),
  ])

  return evaluatePreSoakRuntimeReadiness({
    network: options.network,
    mainnetEnabled: options.mainnetEnabled,
    expectedBase: options.expectedBase,
    history: options.history,
    replacementBaseDryRunPassed: options.replacementBaseDryRunPassed,
    binding,
    fastLane,
    diff,
    protectedCollector,
    recentRuns: (runResponse.results ?? []).map((row) => ({ runAt: row.run_at, status: row.status })),
  }, options.nowMs)
}
