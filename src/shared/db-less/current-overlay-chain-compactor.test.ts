import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type { ValidatedLedgerTransaction } from '../../collector/incremental/validated-ledger-parser'
import { buildDbLessChannel, type DbLessArtifactLocationV1 } from './channel'
import { buildDbLessCurrentOverlayCheckpointFromChannel } from './current-overlay-chain-compactor'
import { buildDbLessLiveChainArtifacts } from './live-chain'
import { buildDbLessLiveDeltaArtifacts } from './live-delta'

const BASE = 'A'.repeat(64)
const L101 = 'B'.repeat(64)
const L102 = 'C'.repeat(64)
const TX1 = 'D'.repeat(64)
const TX2 = 'E'.repeat(64)
const LOAN = 'F'.repeat(64)
const BROKER = '1'.repeat(64)
const SHA = 'a'.repeat(64)

const LOCATION_1: DbLessArtifactLocationV1 = {
  provider: 'github-release',
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'live-data-1',
}
const LOCATION_2: DbLessArtifactLocationV1 = {
  provider: 'github-release',
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'live-data-2',
}

function completeLoanFields() {
  return {
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
  }
}

function transaction(options: {
  hash: string
  action: 'created' | 'deleted'
}): ValidatedLedgerTransaction {
  const node = options.action === 'created'
    ? {
        CreatedNode: {
          LedgerEntryType: 'Loan',
          LedgerIndex: LOAN,
          NewFields: completeLoanFields(),
        },
      }
    : {
        DeletedNode: {
          LedgerEntryType: 'Loan',
          LedgerIndex: LOAN,
          FinalFields: {
            ...completeLoanFields(),
            PaymentRemaining: 0,
            PrincipalOutstanding: '0',
            TotalValueOutstanding: '0',
          },
        },
      }

  return {
    hash: options.hash,
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
      AffectedNodes: [node],
    },
  }
}

function scan(options: {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  event: ValidatedLedgerTransaction
}): IncrementalScanResult {
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: options.ledgerIndex,
    endLedgerIndex: options.ledgerIndex,
    latestValidatedLedger: options.ledgerIndex,
    completeToLatest: true,
    ledgers: [{
      endpoint: 'https://example.invalid',
      ledgerIndex: options.ledgerIndex,
      ledgerHash: options.ledgerHash,
      parentHash: options.parentHash,
      closeTime: 800_000_000 + options.ledgerIndex,
      transactions: [options.event],
      lendingTransactions: [options.event],
    }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 1,
    },
  }
}

function locationKey(location: DbLessArtifactLocationV1, key: string): string {
  if (location.provider !== 'github-release') throw new Error('test uses Release locations only')
  return `${location.releaseTag}|${key}`
}

async function fixture() {
  const firstDelta = await buildDbLessLiveDeltaArtifacts({
    scan: scan({
      ledgerIndex: 101,
      ledgerHash: L101,
      parentHash: BASE,
      event: transaction({ hash: TX1, action: 'created' }),
    }),
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    previousLedgerIndex: 100,
    expectedParentHash: BASE,
    sourceRevision: 'revision-test',
  })
  const firstChain = await buildDbLessLiveChainArtifacts({
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    baseLedgerIndex: 100,
    baseLedgerHash: BASE,
    publicationLocation: LOCATION_1,
    deltaManifest: firstDelta.manifest,
    deltaManifestArtifact: firstDelta.manifestArtifact,
  })

  const secondDelta = await buildDbLessLiveDeltaArtifacts({
    scan: scan({
      ledgerIndex: 102,
      ledgerHash: L102,
      parentHash: L101,
      event: transaction({ hash: TX2, action: 'deleted' }),
    }),
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    previousLedgerIndex: 101,
    expectedParentHash: L101,
    sourceRevision: 'revision-test',
  })
  const secondChain = await buildDbLessLiveChainArtifacts({
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    baseLedgerIndex: 100,
    baseLedgerHash: BASE,
    publicationLocation: LOCATION_2,
    previousChain: firstChain.manifest,
    deltaManifest: secondDelta.manifest,
    deltaManifestArtifact: secondDelta.manifestArtifact,
  })

  const channel = await buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: LOCATION_1,
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-manifest.json',
      manifestSha256: SHA,
      ledgerIndex: 100,
      ledgerHash: BASE,
    },
    live: secondChain.channelPointer,
    lastCommittedLedgerIndex: 102,
    lastCommittedLedgerHash: L102,
    historyCoverage: [],
    updatedAt: '2026-09-23T00:00:00.000Z',
  })

  const chainArtifacts = new Map<string, Uint8Array>([
    [locationKey(LOCATION_1, firstChain.manifestArtifact.key), firstChain.manifestArtifact.bytes],
    [locationKey(LOCATION_2, secondChain.manifestArtifact.key), secondChain.manifestArtifact.bytes],
  ])
  const locatedArtifacts = new Map<string, Uint8Array>()
  for (const [location, built] of [
    [LOCATION_1, firstDelta],
    [LOCATION_2, secondDelta],
  ] as const) {
    locatedArtifacts.set(locationKey(location, built.manifestArtifact.key), built.manifestArtifact.bytes)
    for (const artifact of built.chunkArtifacts) {
      locatedArtifacts.set(locationKey(location, artifact.key), artifact.bytes)
    }
  }

  return {
    channel,
    firstDelta,
    secondDelta,
    chainArtifacts,
    locatedArtifacts,
  }
}

describe('D4 full-chain Current compactor', () => {
  it('verifies the D3 chain, reads generations chronologically, and coalesces Current state', async () => {
    const built = await fixture()
    const checkpoint = await buildDbLessCurrentOverlayCheckpointFromChannel({
      channel: built.channel,
      bucketCount: 8,
      readChainArtifact: async (pointer) =>
        built.chainArtifacts.get(locationKey(pointer.location, pointer.manifestKey)) ?? null,
      readLocatedArtifact: async (location, key) =>
        built.locatedArtifacts.get(locationKey(location, key)) ?? null,
    })

    expect(checkpoint.manifest.generationCount).toBe(2)
    expect(checkpoint.manifest.sourceGenerationIds).toEqual([
      built.firstDelta.manifest.generationId,
      built.secondDelta.manifest.generationId,
    ])
    expect(checkpoint.manifest.throughLedgerIndex).toBe(102)
    expect(checkpoint.manifest.entryCount).toBe(1)
    expect(checkpoint.manifest.tombstoneCount).toBe(1)

    const records = checkpoint.shardArtifacts.flatMap((artifact) => {
      const parsed = JSON.parse(new TextDecoder().decode(artifact.bytes)) as {
        records: Array<{
          objectId: string
          sourceLedgerIndex: number
          isTombstone: boolean
          value: unknown
        }>
      }
      return parsed.records
    })
    expect(records).toEqual([
      expect.objectContaining({
        objectId: LOAN,
        sourceLedgerIndex: 102,
        isTombstone: true,
        value: null,
      }),
    ])
  })

  it('fails before compaction when a linked-chain artifact is missing', async () => {
    const built = await fixture()
    built.chainArtifacts.clear()

    await expect(buildDbLessCurrentOverlayCheckpointFromChannel({
      channel: built.channel,
      readChainArtifact: async (pointer) =>
        built.chainArtifacts.get(locationKey(pointer.location, pointer.manifestKey)) ?? null,
      readLocatedArtifact: async (location, key) =>
        built.locatedArtifacts.get(locationKey(location, key)) ?? null,
    })).rejects.toThrow('Missing live chain artifact')
  })

  it('fails when a verified delta chunk is unavailable', async () => {
    const built = await fixture()
    const missing = built.secondDelta.chunkArtifacts[0]!.key
    built.locatedArtifacts.delete(locationKey(LOCATION_2, missing))

    await expect(buildDbLessCurrentOverlayCheckpointFromChannel({
      channel: built.channel,
      readChainArtifact: async (pointer) =>
        built.chainArtifacts.get(locationKey(pointer.location, pointer.manifestKey)) ?? null,
      readLocatedArtifact: async (location, key) =>
        built.locatedArtifacts.get(locationKey(location, key)) ?? null,
    })).rejects.toThrow('Missing live delta chunk')
  })
})
