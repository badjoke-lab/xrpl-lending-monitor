import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type { ValidatedLedgerTransaction } from '../../collector/incremental/validated-ledger-parser'
import type { DbLessArtifactLocationV1 } from './channel'
import { readDbLessCurrentOverlayGeneration } from './current-overlay-generation-reader'
import { buildDbLessLiveDeltaArtifacts } from './live-delta'
import type { DbLessLiveChainDeltaV1 } from './live-chain'

const PARENT = 'A'.repeat(64)
const LEDGER = 'B'.repeat(64)
const TX = 'C'.repeat(64)
const LOAN = 'D'.repeat(64)
const BROKER = 'E'.repeat(64)

function transaction(): ValidatedLedgerTransaction {
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
      AffectedNodes: [
        {
          DeletedNode: {
            LedgerEntryType: 'Loan',
            LedgerIndex: LOAN,
            FinalFields: {
              Borrower: 'rBorrower',
              Flags: 0,
              LoanBrokerID: BROKER,
              LoanID: LOAN,
              PaymentRemaining: 0,
              PrincipalOutstanding: '0',
              TotalValueOutstanding: '0',
            },
          },
        },
      ],
    },
  }
}

function scan(): IncrementalScanResult {
  const event = transaction()
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    latestValidatedLedger: 101,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://example.invalid',
        ledgerIndex: 101,
        ledgerHash: LEDGER,
        parentHash: PARENT,
        closeTime: 800_000_000,
        transactions: [event],
        lendingTransactions: [event],
      },
    ],
    metrics: {
      ledgers: 1,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 1,
    },
  }
}

const LOCATION: DbLessArtifactLocationV1 = {
  provider: 'github-release',
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'db-less-live-data-test',
}

async function fixture() {
  const built = await buildDbLessLiveDeltaArtifacts({
    scan: scan(),
    epochId: 'devnet-test',
    baseIdentity: 'base-test',
    previousLedgerIndex: 100,
    expectedParentHash: PARENT,
    sourceRevision: 'test-revision',
  })
  const delta: DbLessLiveChainDeltaV1 = {
    location: LOCATION,
    generationId: built.manifest.generationId,
    manifestKey: built.manifestArtifact.key,
    manifestSha256: built.manifestArtifact.sha256,
    payloadDigest: built.manifest.payloadDigest,
    previousLedgerIndex: built.manifest.previousLedgerIndex,
    expectedParentHash: built.manifest.expectedParentHash,
    startLedgerIndex: built.manifest.startLedgerIndex,
    startLedgerHash: built.manifest.startLedgerHash,
    endLedgerIndex: built.manifest.endLedgerIndex,
    endLedgerHash: built.manifest.endLedgerHash,
    ledgerCount: built.manifest.ledgerCount,
  }
  const artifacts = new Map<string, Uint8Array>([
    [built.manifestArtifact.key, built.manifestArtifact.bytes],
    ...built.chunkArtifacts.map((artifact) => [artifact.key, artifact.bytes] as const),
  ])
  return { built, delta, artifacts }
}

describe('D4 Current overlay generation reader', () => {
  it('verifies a D3 delta and extracts only Current projection records', async () => {
    const { delta, artifacts } = await fixture()
    const generation = await readDbLessCurrentOverlayGeneration({
      delta,
      readArtifact: async (location, key) => {
        expect(location).toEqual(LOCATION)
        return artifacts.get(key) ?? null
      },
    })

    expect(generation.generationId).toBe(delta.generationId)
    expect(generation.startLedgerIndex).toBe(101)
    expect(generation.endLedgerIndex).toBe(101)
    expect(generation.records).toEqual([
      expect.objectContaining({
        semanticClass: 'current-projection',
        objectId: LOAN,
        isTombstone: true,
        value: null,
      }),
    ])
  })

  it('rejects a delta manifest pointer with the wrong SHA-256', async () => {
    const { delta, artifacts } = await fixture()
    await expect(readDbLessCurrentOverlayGeneration({
      delta: { ...delta, manifestSha256: '0'.repeat(64) },
      readArtifact: async (_location, key) => artifacts.get(key) ?? null,
    })).rejects.toThrow('manifest SHA-256')
  })

  it('rejects a chunk whose bytes no longer match the manifest', async () => {
    const { built, delta, artifacts } = await fixture()
    const firstChunk = built.chunkArtifacts[0]!
    artifacts.set(firstChunk.key, new TextEncoder().encode('{"tampered":true}'))

    await expect(readDbLessCurrentOverlayGeneration({
      delta,
      readArtifact: async (_location, key) => artifacts.get(key) ?? null,
    })).rejects.toThrow('chunk byte count mismatch')
  })
})
