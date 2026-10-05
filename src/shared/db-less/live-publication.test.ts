import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type { ValidatedLedgerTransaction } from '../../collector/incremental/validated-ledger-parser'
import {
  buildDbLessChannel,
  type DbLessChannelV1,
} from './channel'
import {
  finalizeDbLessLivePublication,
  prepareDbLessLiveDelta,
  prepareDbLessLivePublication,
} from './live-publication'

const LOCATION = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'test-release',
}
const SECOND_LOCATION = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'test-release-2',
}

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const SHA = 'a'.repeat(64)
const LOAN = 'F'.repeat(64)
const BROKER = '1'.repeat(64)
const TX = 'D'.repeat(64)

function currentMutationTransaction(): ValidatedLedgerTransaction {
  return {
    hash: TX,
    transactionType: 'LoanDelete',
    account: 'rOperator',
    sequence: 7,
    fee: '12',
    result: 'tesSUCCESS',
    transactionIndex: 0,
    transaction: {
      TransactionType: 'LoanDelete',
      Account: 'rOperator',
    },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: 0,
      AffectedNodes: [{
        CreatedNode: {
          LedgerEntryType: 'Loan',
          LedgerIndex: LOAN,
          NewFields: {
            Borrower: 'rBorrower',
            Flags: 0,
            LoanBrokerID: BROKER,
            LoanSequence: 7,
            StartDate: 1000,
            PaymentInterval: 300,
            GracePeriod: 20,
            PreviousPaymentDueDate: 1000,
            NextPaymentDueDate: 1300,
            PaymentRemaining: 3,
            PrincipalOutstanding: '900',
            TotalValueOutstanding: '990',
            PeriodicPayment: '330',
          },
        },
      }],
    },
  }
}

async function initialChannel(): Promise<DbLessChannelV1> {
  return buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: LOCATION,
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-test-manifest.json',
      manifestSha256: SHA,
      ledgerIndex: 100,
      ledgerHash: A,
    },
    live: null,
    lastCommittedLedgerIndex: 100,
    lastCommittedLedgerHash: A,
    historyCoverage: [],
    updatedAt: '2026-09-20T00:00:00.000Z',
  })
}

function scan(options: {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  latestValidatedLedger?: number
  event?: ValidatedLedgerTransaction
}): IncrementalScanResult {
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: options.ledgerIndex,
    endLedgerIndex: options.ledgerIndex,
    latestValidatedLedger: options.latestValidatedLedger ?? options.ledgerIndex,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://example.invalid',
        ledgerIndex: options.ledgerIndex,
        ledgerHash: options.ledgerHash,
        parentHash: options.parentHash,
        closeTime: 800_000_000 + options.ledgerIndex,
        transactions: options.event ? [options.event] : [],
        lendingTransactions: options.event ? [options.event] : [],
      },
    ],
    metrics: {
      ledgers: 1,
      inspectedTransactions: options.event ? 1 : 0,
      lendingTransactions: options.event ? 1 : 0,
      elapsedMs: 1,
    },
  }
}

function caughtUpScan(): IncrementalScanResult {
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: 101,
    endLedgerIndex: null,
    latestValidatedLedger: 100,
    completeToLatest: true,
    ledgers: [],
    metrics: {
      ledgers: 0,
      inspectedTransactions: 0,
      lendingTransactions: 0,
      elapsedMs: 1,
    },
  }
}

describe('DB-less live publication preparation', () => {
  it('returns the existing verified channel when already caught up', async () => {
    const channel = await initialChannel()
    const result = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: caughtUpScan(),
      sourceRevision: 'revision-a',
    })

    expect(result).toEqual({ status: 'caught-up', channel })
  })

  it('prepares first delta, chain, and next channel without a persistence provider', async () => {
    const channel = await initialChannel()
    const result = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })

    expect(result.status).toBe('prepared')
    if (result.status !== 'prepared') return

    expect(result.immutableArtifacts.length).toBeGreaterThanOrEqual(3)
    expect(result.chain.manifest.generationCount).toBe(1)
    expect(result.chain.manifest.previous).toBeNull()
    expect(result.chain.manifest.delta.location).toEqual(LOCATION)
    expect(result.nextChannel.lastCommittedLedgerIndex).toBe(101)
    expect(result.nextChannel.lastCommittedLedgerHash).toBe(B)
    expect(result.nextChannel.live?.manifestKey).toBe(result.chain.manifestArtifact.key)
    expect(result.nextChannel.currentProjectionTail).toEqual({
      schemaVersion: 1,
      coverageStartLedgerIndex: 100,
      coverageStartLedgerHash: A,
      generations: [],
    })
    expect(result.nextChannel.historyCoverage).toEqual([
      expect.objectContaining({
        rangeId: 'live:base-test',
        source: 'live',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
      }),
    ])
  })

  it('extends one live chain and one live history range across consecutive runs', async () => {
    const channel = await initialChannel()
    const first = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })
    if (first.status !== 'prepared') throw new Error('expected first publication')

    const second = await prepareDbLessLivePublication({
      channel: first.nextChannel,
      publicationLocation: SECOND_LOCATION,
      previousChain: first.chain.manifest,
      scan: scan({ ledgerIndex: 102, ledgerHash: C, parentHash: B }),
      sourceRevision: 'revision-a',
    })
    if (second.status !== 'prepared') throw new Error('expected second publication')

    expect(second.chain.manifest.generationCount).toBe(2)
    expect(second.chain.manifest.previous?.location).toEqual(LOCATION)
    expect(second.chain.manifest.previous?.generationId).toBe(first.chain.manifest.generationId)
    expect(second.chain.manifest.delta.location).toEqual(SECOND_LOCATION)
    expect(second.chain.manifest.startLedgerIndex).toBe(101)
    expect(second.chain.manifest.startLedgerHash).toBe(B)
    expect(second.chain.manifest.endLedgerIndex).toBe(102)
    expect(second.nextChannel.lastCommittedLedgerIndex).toBe(102)
    expect(second.nextChannel.lastCommittedLedgerHash).toBe(C)
    expect(second.nextChannel.live?.location).toEqual(SECOND_LOCATION)
    expect(second.nextChannel.live?.startLedgerHash).toBe(B)
    expect(second.nextChannel.historyCoverage).toHaveLength(1)
    expect(second.nextChannel.historyCoverage[0]).toMatchObject({
      rangeId: 'live:base-test',
      startLedgerIndex: 101,
      startLedgerHash: B,
      endLedgerIndex: 102,
      endLedgerHash: C,
    })
  })


  it('indexes only generations that contain Current projection mutations', async () => {
    const channel = await initialChannel()
    const zero = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })
    if (zero.status !== 'prepared') throw new Error('expected zero-mutation publication')
    expect(zero.delta.manifest.semanticCounts.currentProjectionMutations).toBe(0)
    expect(zero.nextChannel.currentProjectionTail?.generations).toHaveLength(0)

    const mutated = await prepareDbLessLivePublication({
      channel: zero.nextChannel,
      publicationLocation: SECOND_LOCATION,
      previousChain: zero.chain.manifest,
      scan: scan({
        ledgerIndex: 102,
        ledgerHash: C,
        parentHash: B,
        event: currentMutationTransaction(),
      }),
      sourceRevision: 'revision-a',
    })
    if (mutated.status !== 'prepared') throw new Error('expected mutation publication')

    expect(mutated.delta.manifest.semanticCounts.currentProjectionMutations).toBe(1)
    expect(mutated.nextChannel.currentProjectionTail).toMatchObject({
      schemaVersion: 1,
      coverageStartLedgerIndex: 100,
      coverageStartLedgerHash: A,
      generations: [{
        location: SECOND_LOCATION,
        generationId: mutated.delta.manifest.generationId,
        manifestKey: mutated.delta.manifestArtifact.key,
        manifestSha256: mutated.delta.manifestArtifact.sha256,
        previousLedgerIndex: 101,
        startLedgerIndex: 102,
        endLedgerIndex: 102,
        currentProjectionMutations: 1,
      }],
    })
  })

  it('rejects an active live channel when its previous chain is missing', async () => {
    const channel = await initialChannel()
    const first = await prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })
    if (first.status !== 'prepared') throw new Error('expected first publication')

    await expect(prepareDbLessLivePublication({
      channel: first.nextChannel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 102, ledgerHash: C, parentHash: B }),
      sourceRevision: 'revision-a',
    })).rejects.toThrow('requires its previous live chain')
  })

  it('rejects a scan whose first parent hash diverges from the committed channel', async () => {
    const channel = await initialChannel()

    await expect(prepareDbLessLivePublication({
      channel,
      publicationLocation: LOCATION,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: C }),
      sourceRevision: 'revision-a',
    })).rejects.toThrow('first parent hash')
  })
  it('can choose the immutable Release only after delta artifact count is known', async () => {
    const channel = await initialChannel()
    const prepared = await prepareDbLessLiveDelta({
      channel,
      scan: scan({ ledgerIndex: 101, ledgerHash: B, parentHash: A }),
      sourceRevision: 'revision-a',
    })
    if (prepared.status !== 'delta-prepared') throw new Error('expected delta preparation')

    expect(prepared.immutableArtifactCountBeforeChain).toBe(
      prepared.delta.chunkArtifacts.length + 1,
    )

    const alternateLocation = {
      provider: 'github-release' as const,
      repository: 'badjoke-lab/xrpl-lending-monitor',
      releaseTag: 'test-release-r1',
    }
    const finalized = await finalizeDbLessLivePublication({
      prepared,
      publicationLocation: alternateLocation,
    })

    expect(finalized.immutableArtifacts).toHaveLength(
      prepared.immutableArtifactCountBeforeChain + 1,
    )
    expect(finalized.chain.manifest.publicationLocation).toEqual(alternateLocation)
    expect(finalized.nextChannel.live?.location).toEqual(alternateLocation)
  })

})