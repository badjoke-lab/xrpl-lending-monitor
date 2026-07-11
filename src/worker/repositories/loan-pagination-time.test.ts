import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  loanPaginationScope,
  resolveLoanPaginationEvaluationTime,
  type LoanPaginationTimeOptions,
} from './loan-pagination-time'
import { encodeThreeLayerCursor } from './three-layer-cursor'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-loan-pagination',
  epochId: 'epoch-loan-pagination',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'B'.repeat(64),
  vaultCount: 1,
  loanBrokerCount: 1,
  loanCount: 100,
  objectCount: 102,
  shardCount: 3,
  compressedBytes: 0,
  completedAt: '2026-07-11T00:00:00.000Z',
}

const firstPage: LoanPaginationTimeOptions = {
  sort: 'id_asc',
  query: 'rBorrower:primary',
  onLedgerStatus: 'active',
  scheduleStatus: 'current',
  evaluatedAtRippleTime: 100,
}

function cursor(): string {
  return encodeThreeLayerCursor({
    v: 1,
    snapshot: snapshot.id,
    kind: 'loan',
    direction: 'asc',
    scope: loanPaginationScope(firstPage, firstPage.evaluatedAtRippleTime),
    canonicalCursor: null,
    canonicalOffset: 0,
    canonicalDone: false,
    fastAfter: null,
    fastOffset: 0,
    fastDone: false,
    fastToken: 'fast-lane-shadow-devnet:2026-07-11T07:00:00.000Z',
  })
}

describe('Loan pagination evaluation time', () => {
  it('reuses the first-page evaluation time when the next request clock has advanced', () => {
    expect(resolveLoanPaginationEvaluationTime({
      ...firstPage,
      cursor: cursor(),
      evaluatedAtRippleTime: 105,
    })).toBe(100)
  })

  it('does not reuse a cursor time after query filters change', () => {
    expect(resolveLoanPaginationEvaluationTime({
      ...firstPage,
      query: 'different borrower',
      cursor: cursor(),
      evaluatedAtRippleTime: 105,
    })).toBe(105)
  })

  it('falls back to the request time for malformed cursors', () => {
    expect(resolveLoanPaginationEvaluationTime({
      ...firstPage,
      cursor: 'not-a-cursor',
      evaluatedAtRippleTime: 105,
    })).toBe(105)
  })
})
