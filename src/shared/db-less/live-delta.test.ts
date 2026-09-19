import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type { ValidatedLedgerTransaction } from '../../collector/incremental/validated-ledger-parser'
import { buildDbLessLiveDeltaArtifacts } from './live-delta'

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

describe('DB-less live delta artifacts', () => {
  it('emits Current and History semantic classes without a persistence provider', async () => {
    const built = await buildDbLessLiveDeltaArtifacts({
      scan: scan(),
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      previousLedgerIndex: 100,
      expectedParentHash: PARENT,
      sourceRevision: 'test-revision',
    })

    expect(built.manifest.startLedgerIndex).toBe(101)
    expect(built.manifest.endLedgerIndex).toBe(101)
    expect(built.manifest.expectedParentHash).toBe(PARENT)
    expect(built.manifest.semanticCounts).toMatchObject({
      validatedLedgers: 1,
      protocolEvents: 1,
      loanLifecycleEvents: 1,
      archivedObjects: 1,
      currentProjectionMutations: 1,
    })
    expect(built.manifest.semanticCounts.objectChanges).toBeGreaterThan(0)

    const semanticClasses = new Set(
      built.normalized.chunks.flatMap((chunk) =>
        chunk.chunk.records.map((record) => record.semanticClass),
      ),
    )
    expect(semanticClasses).toEqual(new Set([
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'current-projection',
    ]))

    const current = built.normalized.payload.currentProjectionMutations
    expect(current).toEqual([
      expect.objectContaining({
        semanticClass: 'current-projection',
        objectId: LOAN,
        isTombstone: true,
        value: null,
      }),
    ])
  })

  it('uses source revision in immutable generation identity without changing semantic payload', async () => {
    const common = {
      scan: scan(),
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      previousLedgerIndex: 100,
      expectedParentHash: PARENT,
    }
    const left = await buildDbLessLiveDeltaArtifacts({
      ...common,
      sourceRevision: 'revision-a',
    })
    const right = await buildDbLessLiveDeltaArtifacts({
      ...common,
      sourceRevision: 'revision-b',
    })

    expect(left.manifest.payloadDigest).toBe(right.manifest.payloadDigest)
    expect(left.manifest.generationId).not.toBe(right.manifest.generationId)
    expect(left.manifestArtifact.key).not.toBe(right.manifestArtifact.key)
  })

  it('is byte-for-byte deterministic for the same validated input', async () => {
    const options = {
      scan: scan(),
      epochId: 'devnet-test',
      baseIdentity: 'base-test',
      previousLedgerIndex: 100,
      expectedParentHash: PARENT,
      sourceRevision: 'test-revision',
    }
    const left = await buildDbLessLiveDeltaArtifacts(options)
    const right = await buildDbLessLiveDeltaArtifacts(options)

    expect(left.manifest).toEqual(right.manifest)
    expect(left.manifestArtifact.sha256).toBe(right.manifestArtifact.sha256)
    expect(Array.from(left.manifestArtifact.bytes)).toEqual(Array.from(right.manifestArtifact.bytes))
    expect(left.chunkArtifacts.map((artifact) => artifact.sha256)).toEqual(
      right.chunkArtifacts.map((artifact) => artifact.sha256),
    )
    expect(left.chunkArtifacts.map((artifact) => Array.from(artifact.bytes))).toEqual(
      right.chunkArtifacts.map((artifact) => Array.from(artifact.bytes)),
    )
  })
})