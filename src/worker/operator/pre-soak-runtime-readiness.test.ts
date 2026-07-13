import { describe, expect, it } from 'vitest'

import type { PreSoakRuntimeEvidence } from './pre-soak-runtime-readiness'
import { evaluatePreSoakRuntimeReadiness } from './pre-soak-runtime-readiness'

const now = Date.parse('2026-07-12T12:10:00.000Z')
const base = {
  epochId: 'devnet-3371675',
  snapshotId: 'devnet-3592674-0373cda0b0cd',
  ledgerIndex: 3_592_674,
  ledgerHash: 'A'.repeat(64),
}

function evidence(): PreSoakRuntimeEvidence {
  return {
    network: 'devnet',
    mainnetEnabled: 'false',
    expectedBase: base,
    history: {
      status: 'ok',
      mode: 'hybrid',
      epochId: base.epochId,
      ledgerIndex: base.ledgerIndex,
      ledgerHash: base.ledgerHash,
      exactIndexConfigured: true,
    },
    replacementBaseDryRunPassed: true,
    binding: {
      shadowEpochId: 'fast-lane-shadow-devnet',
      base,
      boundAt: '2026-07-12T12:00:00.000Z',
    },
    fastLane: {
      epochId: 'fast-lane-shadow-devnet',
      lastProcessedLedger: 3_593_000,
      lastProcessedHash: 'B'.repeat(64),
      latestObservedLedger: 3_593_008,
      latestObservedHash: 'C'.repeat(64),
      status: 'behind',
      updatedAt: '2026-07-12T12:09:00.000Z',
    },
    diff: {
      schemaVersion: 1,
      status: 'ok',
      passed: true,
      reason: null,
      binding: {
        shadowEpochId: 'fast-lane-shadow-devnet',
        base,
        boundAt: '2026-07-12T12:00:00.000Z',
      },
      fastLane: {
        ledgerIndex: 3_593_000,
        ledgerHash: 'B'.repeat(64),
        updatedAt: '2026-07-12T12:09:00.000Z',
      },
      canonicalOverlay: {
        ledgerIndex: base.ledgerIndex,
        ledgerHash: base.ledgerHash,
        updatedAt: '2026-07-12T11:00:00.000Z',
      },
      sample: {
        limit: 500,
        sampledRows: 10,
        canonicalMissingRows: 0,
        canonicalAheadRows: 0,
        fastAheadRows: 0,
        exactSourceMatches: 10,
        exactProjectionMatches: 10,
        exactProjectionMismatches: 0,
      },
    },
    protectedCollector: {
      network: 'devnet',
      status: 'behind',
      lastAttemptAt: '2026-07-12T09:00:00.000Z',
      lastSuccessAt: '2026-07-12T09:00:00.000Z',
      consecutiveFailures: 0,
      lagLedgers: 100,
      endpoint: 'https://example.invalid',
      lastRunDurationMs: 1,
      lastRpcRequests: 1,
      lastEndpointAttempts: 1,
      lastLedgersProcessed: 1,
      lastInspectedTransactions: 0,
      lastLendingTransactions: 0,
      lastEstimatedRows: 0,
      lastEstimatedStatements: 0,
      lastOverlayMutations: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-07-12T09:00:00.000Z',
      updatedAt: '2026-07-12T09:00:00.000Z',
    },
    recentRuns: [
      { runAt: '2026-07-12T12:09:00.000Z', status: 'committed' },
      { runAt: '2026-07-12T12:04:00.000Z', status: 'committed' },
      { runAt: '2026-07-12T11:59:00.000Z', status: 'caught_up' },
    ],
  }
}

describe('current pre-soak runtime readiness', () => {
  it('passes the rolling-checkpoint and five-minute fast-lane architecture', () => {
    const report = evaluatePreSoakRuntimeReadiness(evidence(), now)

    expect(report.passed).toBe(true)
    expect(report.architecture).toBe('rolling_checkpoint_fast_lane_v1')
    expect(report.supersedes).toContain('/api/status/m1-exit')
  })

  it('fails when the five-minute lag exceeds ten ledgers', () => {
    const input = evidence()
    input.fastLane!.latestObservedLedger = input.fastLane!.lastProcessedLedger + 11

    const report = evaluatePreSoakRuntimeReadiness(input, now)

    expect(report.passed).toBe(false)
    expect(report.checks.fastLaneFreshness.passed).toBe(false)
  })

  it('fails when a recent fast-lane run errored', () => {
    const input = evidence()
    input.recentRuns[1] = { ...input.recentRuns[1]!, status: 'error' }

    const report = evaluatePreSoakRuntimeReadiness(input, now)

    expect(report.passed).toBe(false)
    expect(report.checks.recentFiveMinuteRuns.passed).toBe(false)
  })

  it('fails when every sampled fast-lane row is missing from canonical comparison data', () => {
    const input = evidence()
    input.diff.passed = false
    input.diff.reason = 'canonical_comparison_population_empty'
    input.diff.sample = {
      ...input.diff.sample!,
      canonicalMissingRows: input.diff.sample!.sampledRows,
      exactSourceMatches: 0,
      exactProjectionMatches: 0,
    }

    const report = evaluatePreSoakRuntimeReadiness(input, now)

    expect(report.passed).toBe(false)
    expect(report.checks.projectionParity.passed).toBe(false)
  })
})
