import { describe, expect, it } from 'vitest'
import type { LiveContinuationVerificationReport, VerificationPath } from './live-continuation-verification'
import { evaluateM1RuntimeExit, type M1RuntimeExitEvidence } from './m1-runtime-exit-gate'

const observed: VerificationPath = { state: 'observed', reason: 'observed' }

function continuation(passed = true): LiveContinuationVerificationReport {
  const path = passed ? observed : { state: 'missing' as const, reason: 'missing' }
  return {
    passed,
    paths: {
      createdCurrent: path,
      modifiedCurrent: path,
      loanPayment: path,
      impaired: path,
      unimpaired: path,
      defaulted: path,
      deletionArchive: path,
      activityHistoryBalance: path,
      ledgerContinuity: path,
      cursorOverlay: path,
      freshness: path,
    },
  }
}

function readyEvidence(): M1RuntimeExitEvidence {
  return {
    expectedBase: {
      epochId: 'epoch-base',
      snapshotId: 'snapshot-base',
      ledgerIndex: 100,
      ledgerHash: 'H100',
    },
    boundBase: {
      epochId: 'epoch-base',
      snapshotId: 'snapshot-base',
      ledgerIndex: 100,
      ledgerHash: 'H100',
    },
    processedLedgers: { count: 20, minimum: 101, maximum: 120 },
    cursor: {
      lastProcessedLedger: 120,
      lastProcessedHash: 'H120',
      latestObservedLedger: 120,
      latestObservedHash: 'H120',
    },
    continuation: continuation(true),
  }
}

describe('M1 runtime exit gate', () => {
  it('is ready only when base, catch-up start, head, and live continuation gates pass', () => {
    const report = evaluateM1RuntimeExit(readyEvidence())
    expect(report.ready).toBe(true)
    expect(Object.values(report.gates).every((gate) => gate.state === 'observed')).toBe(true)
  })

  it('keeps unavailable or incomplete runtime evidence missing', () => {
    const evidence = readyEvidence()
    evidence.expectedBase = { epochId: null, snapshotId: null, ledgerIndex: null, ledgerHash: null }
    evidence.processedLedgers = { count: 0, minimum: null, maximum: null }
    evidence.cursor.lastProcessedLedger = 119
    evidence.continuation = continuation(false)

    const report = evaluateM1RuntimeExit(evidence)
    expect(report.ready).toBe(false)
    expect(report.gates.verifiedBaseBinding.state).toBe('missing')
    expect(report.gates.catchUpStart.state).toBe('missing')
    expect(report.gates.validatedHeadReached.state).toBe('missing')
    expect(report.gates.liveContinuation.state).toBe('missing')
  })

  it('reports contradictory base and head evidence as inconsistent', () => {
    const evidence = readyEvidence()
    evidence.boundBase.snapshotId = 'other-snapshot'
    evidence.cursor.latestObservedLedger = 119

    const report = evaluateM1RuntimeExit(evidence)
    expect(report.ready).toBe(false)
    expect(report.gates.verifiedBaseBinding.state).toBe('inconsistent')
    expect(report.gates.validatedHeadReached.state).toBe('inconsistent')
  })
})
