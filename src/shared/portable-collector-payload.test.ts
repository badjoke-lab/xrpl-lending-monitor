import { describe, expect, it } from 'vitest'

import {
  PortablePayloadResourceHaltError,
  PortablePayloadValidationError,
  buildNormalizedCollectorPayload,
  buildNormalizedPayloadChunks,
  decodeAndVerifyNormalizedPayloadChunk,
  sha256PortableJson,
  type BuildNormalizedCollectorPayloadInput,
  type NormalizedCandidateV1,
  type NormalizedSemanticClassV1,
} from './portable-collector-payload'

const parentHash = 'A'.repeat(64)
const ledger101Hash = 'B'.repeat(64)
const ledger102Hash = 'C'.repeat(64)
const transaction101 = 'D'.repeat(64)
const transaction102 = 'E'.repeat(64)

function candidate(
  semanticClass: NormalizedSemanticClassV1,
  canonicalKey: string,
  sourceLedgerIndex: 101 | 102,
  overrides: Partial<NormalizedCandidateV1> = {},
): NormalizedCandidateV1 {
  return {
    semanticClass,
    canonicalKey,
    sourceLedgerIndex,
    sourceLedgerHash: sourceLedgerIndex === 101 ? ledger101Hash : ledger102Hash,
    sourceTransactionHash: semanticClass === 'validated-ledger'
      ? null
      : sourceLedgerIndex === 101
        ? transaction101
        : transaction102,
    objectId: null,
    relationshipIds: [],
    isTombstone: false,
    value: { canonicalKey, kind: semanticClass },
    ...overrides,
  }
}

function completeInput(): BuildNormalizedCollectorPayloadInput {
  return {
    workId: 'work-101-102',
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: parentHash,
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    finalLedgerHash: ledger102Hash,
    ledgers: [
      candidate('validated-ledger', 'ledger:102', 102, {
        value: {
          parentHash: ledger101Hash,
          ledgerHash: ledger102Hash,
          ledgerIndex: 102,
        },
      }),
      candidate('validated-ledger', 'ledger:101', 101, {
        value: {
          ledgerHash: ledger101Hash,
          ledgerIndex: 101,
          parentHash,
        },
      }),
    ],
    protocolEvents: [
      candidate('protocol-event', 'event:1', 101, {
        relationshipIds: ['loan:2', 'loan:1', 'loan:2'],
        value: { z: 2, a: 1 },
      }),
    ],
    objectChanges: [
      candidate('object-change', 'change:1', 101, { objectId: 'loan:1' }),
    ],
    loanLifecycleEvents: [
      candidate('loan-lifecycle', 'lifecycle:1', 102, { objectId: 'loan:1' }),
    ],
    archivedObjects: [
      candidate('archived-object', 'archive:1', 102, { objectId: 'loan:2' }),
    ],
    balanceHistory: [candidate('balance-history', 'balance:1', 102)],
    currentProjectionMutations: [
      candidate('current-projection', 'projection:1', 102, {
        objectId: 'loan:1',
        isTombstone: true,
        value: null,
      }),
    ],
  }
}

describe('normalized collector payload', () => {
  it('uses canonical SHA-256 over recursively sorted portable JSON', async () => {
    await expect(sha256PortableJson({ b: 2, a: 1 })).resolves.toBe(
      'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    )
  })

  it('normalizes all seven semantic groups and is independent of input ordering', async () => {
    const first = await buildNormalizedCollectorPayload(completeInput())
    const reordered = completeInput()
    reordered.ledgers.reverse()
    reordered.protocolEvents[0] = {
      ...reordered.protocolEvents[0]!,
      relationshipIds: ['loan:1', 'loan:2'],
      value: { a: 1, z: 2 },
    }
    const second = await buildNormalizedCollectorPayload(reordered)

    expect(first).toEqual(second)
    expect(first.ledgers.map((entry) => entry.sourceLedgerIndex)).toEqual([101, 102])
    expect(first.protocolEvents[0]?.relationshipIds).toEqual(['loan:1', 'loan:2'])
    expect(first.semanticCounts).toEqual({
      validatedLedgers: 2,
      protocolEvents: 1,
      objectChanges: 1,
      loanLifecycleEvents: 1,
      archivedObjects: 1,
      balanceHistory: 1,
      currentProjectionMutations: 1,
      totalRecords: 8,
    })
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })

  it('keeps zero-count semantic groups explicit', async () => {
    const input = completeInput()
    input.protocolEvents = []
    input.objectChanges = []
    input.loanLifecycleEvents = []
    input.archivedObjects = []
    input.balanceHistory = []
    input.currentProjectionMutations = []

    const payload = await buildNormalizedCollectorPayload(input)
    expect(payload.semanticCounts).toEqual({
      validatedLedgers: 2,
      protocolEvents: 0,
      objectChanges: 0,
      loanLifecycleEvents: 0,
      archivedObjects: 0,
      balanceHistory: 0,
      currentProjectionMutations: 0,
      totalRecords: 2,
    })
  })

  it('rejects duplicate identities and broken ledger continuity', async () => {
    const duplicate = completeInput()
    duplicate.protocolEvents.push({ ...duplicate.protocolEvents[0]! })
    await expect(buildNormalizedCollectorPayload(duplicate)).rejects.toThrow(
      'duplicate candidate identity',
    )

    const brokenParent = completeInput()
    brokenParent.ledgers[0] = {
      ...brokenParent.ledgers[0]!,
      value: {
        parentHash: 'F'.repeat(64),
        ledgerHash: ledger102Hash,
        ledgerIndex: 102,
      },
    }
    await expect(buildNormalizedCollectorPayload(brokenParent)).rejects.toThrow(
      'parent hash mismatch',
    )
  })

  it('splits deterministic bounded chunks and verifies every encoded chunk', async () => {
    const payload = await buildNormalizedCollectorPayload(completeInput())
    const chunks = await buildNormalizedPayloadChunks(payload, {
      maxRecords: 3,
      maxEncodedBytes: 8_000,
    })

    expect(chunks).toHaveLength(3)
    expect(chunks.map(({ chunk }) => chunk.records.length)).toEqual([3, 3, 2])
    expect(chunks.map(({ chunk }) => chunk.chunkIndex)).toEqual([0, 1, 2])
    expect(chunks.every(({ chunk }) => chunk.totalChunks === 3)).toBe(true)
    expect(chunks.every(({ chunk }) => chunk.payloadDigest === payload.digest)).toBe(true)

    const decoded = await Promise.all(
      chunks.map(({ encoded }) =>
        decodeAndVerifyNormalizedPayloadChunk(encoded, payload.digest),
      ),
    )
    expect(decoded.flatMap((chunk) => chunk.records)).toHaveLength(8)
  })

  it('halts when one record cannot fit and rejects chunk tampering', async () => {
    const input = completeInput()
    input.protocolEvents[0] = {
      ...input.protocolEvents[0]!,
      value: { payload: 'x'.repeat(2_000) },
    }
    const payload = await buildNormalizedCollectorPayload(input)

    await expect(
      buildNormalizedPayloadChunks(payload, {
        maxRecords: 40,
        maxEncodedBytes: 700,
      }),
    ).rejects.toBeInstanceOf(PortablePayloadResourceHaltError)

    const safeChunks = await buildNormalizedPayloadChunks(payload, {
      maxRecords: 40,
      maxEncodedBytes: 8_000,
    })
    const tampered = JSON.parse(safeChunks[0]!.encodedJson) as {
      records: Array<{ value: unknown }>
    }
    tampered.records[0]!.value = { changed: true }

    await expect(
      decodeAndVerifyNormalizedPayloadChunk(
        new TextEncoder().encode(JSON.stringify(tampered)),
        payload.digest,
      ),
    ).rejects.toBeInstanceOf(PortablePayloadValidationError)
  })
})
