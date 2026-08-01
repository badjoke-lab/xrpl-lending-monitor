import { describe, expect, it } from 'vitest'

import {
  PortablePayloadValidationError,
  buildNormalizedCollectorPayload,
  buildNormalizedPayloadChunks,
  type BuildNormalizedCollectorPayloadInput,
  type NormalizedCandidateV1,
} from './portable-collector-payload'

const parentHash = 'A'.repeat(64)
const ledgerHash = 'B'.repeat(64)
const transactionHash = 'C'.repeat(64)

function ledger(): NormalizedCandidateV1 {
  return {
    semanticClass: 'validated-ledger',
    canonicalKey: 'ledger:101',
    sourceLedgerIndex: 101,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash: null,
    objectId: null,
    relationshipIds: [],
    isTombstone: false,
    value: {
      ledgerIndex: 101,
      ledgerHash,
      parentHash,
    },
  }
}

function input(): BuildNormalizedCollectorPayloadInput {
  return {
    workId: 'work-101',
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: parentHash,
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    finalLedgerHash: ledgerHash,
    ledgers: [ledger()],
    protocolEvents: [
      {
        semanticClass: 'protocol-event',
        canonicalKey: 'event:1',
        sourceLedgerIndex: 101,
        sourceLedgerHash: ledgerHash,
        sourceTransactionHash: transactionHash,
        objectId: null,
        relationshipIds: [],
        isTombstone: false,
        value: { transactionType: 'LoanSet' },
      },
    ],
    objectChanges: [],
    loanLifecycleEvents: [],
    archivedObjects: [],
    balanceHistory: [],
    currentProjectionMutations: [],
  }
}

describe('normalized payload source identity', () => {
  it('rejects a semantic candidate bound to the wrong ledger hash', async () => {
    const value = input()
    value.protocolEvents[0] = {
      ...value.protocolEvents[0]!,
      sourceLedgerHash: 'D'.repeat(64),
    }

    await expect(buildNormalizedCollectorPayload(value)).rejects.toThrow(
      'candidate source ledger hash mismatch',
    )
  })

  it('requires transaction and object identities for applicable classes', async () => {
    const missingTransaction = input()
    missingTransaction.protocolEvents[0] = {
      ...missingTransaction.protocolEvents[0]!,
      sourceTransactionHash: null,
    }
    await expect(buildNormalizedCollectorPayload(missingTransaction)).rejects.toThrow(
      'protocol-event candidate requires a source transaction hash',
    )

    const missingObject = input()
    missingObject.objectChanges = [
      {
        semanticClass: 'object-change',
        canonicalKey: 'change:1',
        sourceLedgerIndex: 101,
        sourceLedgerHash: ledgerHash,
        sourceTransactionHash: transactionHash,
        objectId: null,
        relationshipIds: [],
        isTombstone: false,
        value: { changedFields: ['Balance'] },
      },
    ]
    await expect(buildNormalizedCollectorPayload(missingObject)).rejects.toThrow(
      'object-change candidate requires an object ID',
    )
  })

  it('rejects changed payload content before chunk construction', async () => {
    const payload = await buildNormalizedCollectorPayload(input())
    payload.protocolEvents[0] = {
      ...payload.protocolEvents[0]!,
      value: { transactionType: 'ChangedAfterDigest' },
    }

    await expect(buildNormalizedPayloadChunks(payload)).rejects.toBeInstanceOf(
      PortablePayloadValidationError,
    )
  })
})
