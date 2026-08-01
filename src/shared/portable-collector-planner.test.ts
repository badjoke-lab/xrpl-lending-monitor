import { describe, expect, it } from 'vitest'

import {
  buildPortableCollectorWorkId,
  planPortableCollectorScan,
  type PortableLedgerCostEstimate,
  type PortableScanBudget,
} from './portable-collector-planner'

const budget: PortableScanBudget = {
  maxLedgers: 4,
  maxTransactions: 100,
  maxDecodedBytes: 10_000,
  maxNormalizedBytes: 8_000,
  maxPayloadBytes: 6_000,
  maxExternalRequests: 8,
}

function estimate(
  ledgerIndex: number,
  overrides: Partial<PortableLedgerCostEstimate> = {},
): PortableLedgerCostEstimate {
  return {
    ledgerIndex,
    transactionCount: 10,
    decodedBytes: 1_000,
    normalizedBytes: 800,
    payloadBytes: 600,
    externalRequests: 1,
    ...overrides,
  }
}

const identity = {
  network: 'devnet',
  epochId: 'epoch-1',
  baseIdentity: 'base-100',
  previousLedgerIndex: 100,
  expectedParentHash: 'a'.repeat(64),
}

describe('portable collector planner', () => {
  it('selects the largest contiguous prefix inside every budget', () => {
    const plan = planPortableCollectorScan({
      ...identity,
      latestValidatedLedgerIndex: 106,
      budget,
      estimates: [
        estimate(101),
        estimate(102),
        estimate(103),
        estimate(104),
        estimate(105),
      ],
    })

    expect(plan).toMatchObject({
      status: 'planned',
      startLedgerIndex: 101,
      endLedgerIndex: 104,
      stoppedBeforeLedgerIndex: 105,
      usage: {
        ledgers: 4,
        transactions: 40,
        decodedBytes: 4_000,
        normalizedBytes: 3_200,
        payloadBytes: 2_400,
        externalRequests: 4,
      },
    })
  })

  it('stops before a content-heavy ledger instead of weakening semantics', () => {
    const plan = planPortableCollectorScan({
      ...identity,
      latestValidatedLedgerIndex: 103,
      budget,
      estimates: [
        estimate(101),
        estimate(102, { payloadBytes: 5_500 }),
        estimate(103),
      ],
    })

    expect(plan).toMatchObject({
      status: 'planned',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      stoppedBeforeLedgerIndex: 102,
    })
  })

  it('reports a single ledger that cannot fit any allowed scan', () => {
    const plan = planPortableCollectorScan({
      ...identity,
      latestValidatedLedgerIndex: 101,
      budget,
      estimates: [
        estimate(101, {
          transactionCount: 101,
          payloadBytes: 6_001,
        }),
      ],
    })

    expect(plan).toEqual({
      status: 'blocked',
      ledgerIndex: 101,
      reason: 'single-ledger-budget-exceeded',
      exceededBudgets: ['transactions', 'payloadBytes'],
    })
  })

  it('is deterministic and rejects a discontinuous estimate sequence', () => {
    const input = {
      ...identity,
      latestValidatedLedgerIndex: 102,
      budget,
      estimates: [estimate(101), estimate(102)],
    }
    const first = planPortableCollectorScan(input)
    const second = planPortableCollectorScan(input)

    expect(first).toEqual(second)
    expect(first.status).toBe('planned')
    if (first.status === 'planned') {
      expect(first.workId).toBe(buildPortableCollectorWorkId(identity))
      expect(first.planJson).toBe(second.status === 'planned' ? second.planJson : null)
    }

    expect(() =>
      planPortableCollectorScan({
        ...input,
        estimates: [estimate(101), estimate(103)],
      }),
    ).toThrow('cost estimates must be contiguous')
  })
})
