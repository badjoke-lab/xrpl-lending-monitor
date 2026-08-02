import type { IncrementalScanResult } from '../incremental/scan-validated-ledgers'
import {
  buildNormalizedCollectorPayload,
  buildNormalizedPayloadChunks,
  type BuiltNormalizedPayloadChunkV1,
  type NormalizedCandidateV1,
  type NormalizedCollectorPayloadV1,
  type PortableJsonValue,
} from '../../shared/portable-collector-payload'
import { canonicalPortableJson } from '../../shared/portable-collector-reference-store'
import { buildHistorySegmentRecords } from './build-segment-records'

export interface PortablePersistedReferenceRowV1 {
  semanticClass: NormalizedCandidateV1['semanticClass']
  canonicalKey: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  sourceTransactionHash: string | null
  objectId: string | null
  relationshipIds: string[]
  valueJson: string | null
  isTombstone: boolean
}

export interface PortableXrplNormalizedWorkV1 {
  payload: NormalizedCollectorPayloadV1
  chunks: BuiltNormalizedPayloadChunkV1[]
  semanticCountsJson: string
}

function encodeIdentity(value: string): string {
  return encodeURIComponent(value)
}

function relationship(kind: string, value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? `${kind}:${value}` : null
}

function canonicalRelationships(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort(
    (left, right) => left.localeCompare(right),
  )
}

function parsePortableJson(value: string, field: string): PortableJsonValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${field} is not valid JSON`)
  }
  return parsed as PortableJsonValue
}

function objectRelationships(
  relationships: {
    vaultId?: string | null
    loanBrokerId?: string | null
    loanId?: string | null
    account?: string | null
    owner?: string | null
    borrower?: string | null
    assetKey?: string | null
    mptIssuanceId?: string | null
  },
): string[] {
  return canonicalRelationships([
    relationship('vault', relationships.vaultId),
    relationship('broker', relationships.loanBrokerId),
    relationship('loan', relationships.loanId),
    relationship('account', relationships.account),
    relationship('owner', relationships.owner),
    relationship('borrower', relationships.borrower),
    relationship('asset', relationships.assetKey),
    relationship('mpt', relationships.mptIssuanceId),
  ])
}

function projectionRelationships(input: {
  objectType: 'vault' | 'loan_broker' | 'loan'
  objectId: string
  relationships?: {
    owner?: string | null
    account?: string | null
    borrower?: string | null
    vaultId?: string | null
    loanBrokerId?: string | null
    assetKey?: string | null
  }
}): string[] {
  const kind = input.objectType === 'loan_broker' ? 'broker' : input.objectType
  return canonicalRelationships([
    relationship(kind, input.objectId),
    relationship('vault', input.relationships?.vaultId),
    relationship('broker', input.relationships?.loanBrokerId),
    relationship('account', input.relationships?.account),
    relationship('owner', input.relationships?.owner),
    relationship('borrower', input.relationships?.borrower),
    relationship('asset', input.relationships?.assetKey),
  ])
}

function coalescedProjectionCandidates(
  records: ReturnType<typeof buildHistorySegmentRecords>['currentProjectionMutations'],
): NormalizedCandidateV1[] {
  const latest = new Map<string, (typeof records)[number]>()
  for (const record of records) {
    const key = `${record.mutation.objectType}\u0000${record.mutation.objectId}`
    const existing = latest.get(key)
    if (
      !existing ||
      record.ledgerIndex > existing.ledgerIndex ||
      (record.ledgerIndex === existing.ledgerIndex &&
        record.transactionIndex > existing.transactionIndex)
    ) {
      latest.set(key, record)
    }
  }

  return [...latest.values()].map((record) => ({
    semanticClass: 'current-projection',
    canonicalKey: `projection:${record.mutation.objectType}:${encodeIdentity(record.mutation.objectId)}`,
    sourceLedgerIndex: record.ledgerIndex,
    sourceLedgerHash: record.ledgerHash,
    sourceTransactionHash: record.transactionHash,
    objectId: record.mutation.objectId,
    relationshipIds: projectionRelationships(record.mutation),
    isTombstone: record.mutation.operation === 'deleted',
    value:
      record.mutation.operation === 'deleted'
        ? null
        : parsePortableJson(record.mutation.projectionJson, 'projectionJson'),
  }))
}

export async function buildPortableXrplNormalizedWork(options: {
  scan: IncrementalScanResult
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
}): Promise<PortableXrplNormalizedWorkV1> {
  const finalLedger = options.scan.ledgers.at(-1)
  if (!finalLedger || options.scan.endLedgerIndex === null) {
    throw new Error('XRPL normalization requires a non-empty validated scan')
  }

  const records = buildHistorySegmentRecords({
    scan: options.scan,
    epochId: options.epochId,
  })

  const payload = await buildNormalizedCollectorPayload({
    workId: options.workId,
    network: options.network,
    epochId: options.epochId,
    baseIdentity: options.baseIdentity,
    previousLedgerIndex: options.previousLedgerIndex,
    expectedParentHash: options.expectedParentHash,
    startLedgerIndex: options.scan.startLedgerIndex,
    endLedgerIndex: options.scan.endLedgerIndex,
    finalLedgerHash: finalLedger.ledgerHash,
    ledgers: records.ledgers.map((ledger) => ({
      semanticClass: 'validated-ledger',
      canonicalKey: `ledger:${ledger.ledgerIndex}`,
      sourceLedgerIndex: ledger.ledgerIndex,
      sourceLedgerHash: ledger.ledgerHash,
      sourceTransactionHash: null,
      objectId: null,
      relationshipIds: [],
      isTombstone: false,
      value: {
        closeTime: ledger.closeTime,
        inspectedTransactions: ledger.inspectedTransactions,
        ledgerHash: ledger.ledgerHash,
        ledgerIndex: ledger.ledgerIndex,
        lendingTransactions: ledger.lendingTransactions,
        parentHash: ledger.parentHash,
      },
    })),
    protocolEvents: records.protocolEvents.map((event) => ({
      semanticClass: 'protocol-event',
      canonicalKey: `event:${event.eventHash}`,
      sourceLedgerIndex: event.ledgerIndex,
      sourceLedgerHash:
        options.scan.ledgers.find((ledger) => ledger.ledgerIndex === event.ledgerIndex)
          ?.ledgerHash ?? '',
      sourceTransactionHash: event.eventHash,
      objectId: null,
      relationshipIds: canonicalRelationships([
        relationship('account', event.account),
      ]),
      isTombstone: false,
      value: {
        account: event.account,
        closeTime: event.closeTime,
        eventIndex: event.eventIndex,
        eventType: event.eventType,
        fee: event.fee,
        resultCode: event.resultCode,
        sequence: event.sequence,
      },
    })),
    objectChanges: records.objectChanges.map((change) => ({
      semanticClass: 'object-change',
      canonicalKey: [
        'change',
        change.transactionHash,
        String(change.nodeIndex),
        encodeIdentity(change.fieldName),
      ].join(':'),
      sourceLedgerIndex: change.ledgerIndex,
      sourceLedgerHash:
        options.scan.ledgers.find((ledger) => ledger.ledgerIndex === change.ledgerIndex)
          ?.ledgerHash ?? '',
      sourceTransactionHash: change.transactionHash,
      objectId: change.objectId,
      relationshipIds: objectRelationships(change.relationships),
      isTombstone: false,
      value: {
        action: change.action,
        afterJson: change.afterJson,
        beforeJson: change.beforeJson,
        closeTime: change.closeTime,
        fieldName: change.fieldName,
        nodeIndex: change.nodeIndex,
        objectId: change.objectId,
        objectType: change.objectType,
        resultCode: change.result,
        transactionIndex: change.transactionIndex,
        transactionType: change.transactionType,
        unsupportedField: change.unsupportedField,
        valueType: change.valueType,
      },
    })),
    loanLifecycleEvents: records.lifecycleEvents.map((event) => ({
      semanticClass: 'loan-lifecycle',
      canonicalKey: [
        'lifecycle',
        event.transactionHash,
        encodeIdentity(event.loanId),
        event.eventType,
      ].join(':'),
      sourceLedgerIndex: event.ledgerIndex,
      sourceLedgerHash:
        options.scan.ledgers.find((ledger) => ledger.ledgerIndex === event.ledgerIndex)
          ?.ledgerHash ?? '',
      sourceTransactionHash: event.transactionHash,
      objectId: event.loanId,
      relationshipIds: canonicalRelationships([relationship('loan', event.loanId)]),
      isTombstone: event.eventType === 'deleted',
      value: {
        closeTime: event.closeTime,
        detailsJson: event.detailsJson,
        eventType: event.eventType,
        loanId: event.loanId,
        paymentRemainingAfter: event.paymentRemainingAfter,
        paymentRemainingBefore: event.paymentRemainingBefore,
        principalAfter: event.principalAfter,
        principalBefore: event.principalBefore,
        resultCode: event.result,
        statusAfter: event.statusAfter,
        statusBefore: event.statusBefore,
        totalValueAfter: event.totalValueAfter,
        totalValueBefore: event.totalValueBefore,
        transactionIndex: event.transactionIndex,
        transactionType: event.transactionType,
      },
    })),
    archivedObjects: records.archivedObjects.map((record) => ({
      semanticClass: 'archived-object',
      canonicalKey: [
        'archive',
        record.deletionTransactionHash,
        record.objectType,
        encodeIdentity(record.objectId),
      ].join(':'),
      sourceLedgerIndex: record.deletionLedgerIndex,
      sourceLedgerHash:
        options.scan.ledgers.find(
          (ledger) => ledger.ledgerIndex === record.deletionLedgerIndex,
        )?.ledgerHash ?? '',
      sourceTransactionHash: record.deletionTransactionHash,
      objectId: record.objectId,
      relationshipIds: objectRelationships({
        vaultId: record.vaultId,
        loanBrokerId: record.loanBrokerId,
        loanId: record.loanId,
        account: record.account,
        owner: record.owner,
        borrower: record.borrower,
        assetKey: record.assetKey,
      }),
      isTombstone: true,
      value: {
        deletionCloseTime: record.deletionCloseTime,
        deletionReason: record.deletionReason,
        deletionTransactionIndex: record.deletionTransactionIndex,
        finalStateJson: record.finalStateJson,
        objectId: record.objectId,
        objectType: record.objectType,
      },
    })),
    balanceHistory: records.balanceHistory.map((record) => ({
      semanticClass: 'balance-history',
      canonicalKey: [
        'balance',
        record.transactionHash,
        record.subjectType,
        encodeIdentity(record.subjectId),
        record.metricType,
      ].join(':'),
      sourceLedgerIndex: record.ledgerIndex,
      sourceLedgerHash:
        options.scan.ledgers.find((ledger) => ledger.ledgerIndex === record.ledgerIndex)
          ?.ledgerHash ?? '',
      sourceTransactionHash: record.transactionHash,
      objectId: record.subjectId,
      relationshipIds: canonicalRelationships([
        relationship(record.subjectType === 'Vault' ? 'vault' : 'broker', record.subjectId),
        relationship('asset', record.assetKey),
      ]),
      isTombstone: false,
      value: {
        afterValue: record.afterValue,
        assetKey: record.assetKey,
        beforeValue: record.beforeValue,
        closeTime: record.closeTime,
        formula: record.formula,
        metricType: record.metricType,
        sourceFieldsJson: record.sourceFieldsJson,
        subjectId: record.subjectId,
        subjectType: record.subjectType,
        transactionIndex: record.transactionIndex,
      },
    })),
    currentProjectionMutations: coalescedProjectionCandidates(
      records.currentProjectionMutations,
    ),
  })

  return {
    payload,
    chunks: await buildNormalizedPayloadChunks(payload),
    semanticCountsJson: canonicalPortableJson(payload.semanticCounts),
  }
}

export function portableReferenceRowsFromChunk(
  chunk: BuiltNormalizedPayloadChunkV1['chunk'],
): PortablePersistedReferenceRowV1[] {
  return chunk.records.map((record) => ({
    semanticClass: record.semanticClass,
    canonicalKey: record.canonicalKey,
    sourceLedgerIndex: record.sourceLedgerIndex,
    sourceLedgerHash: record.sourceLedgerHash,
    sourceTransactionHash: record.sourceTransactionHash,
    objectId: record.objectId,
    relationshipIds: record.relationshipIds,
    valueJson:
      record.isTombstone && record.value === null
        ? null
        : canonicalPortableJson(record.value),
    isTombstone: record.isTombstone,
  }))
}
