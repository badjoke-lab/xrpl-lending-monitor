import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { canonicalJson, utf8 } from './canonical-json'
import type { SnapshotIndexKind } from './snapshot-index-types'
import type { SnapshotArtifact, SnapshotKind } from './snapshot-types'

export interface EncodedIndexEntry {
  term: string
  sortKey: string
  line: Uint8Array
}

interface ObjectReference {
  id: string
  kind: SnapshotKind
  dataKey: string
}

interface IndexedObject {
  value: ScannedLedgerObject
  reference: ObjectReference
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function stringField(value: ScannedLedgerObject, field: string): string | null {
  const candidate = value[field]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

function dataKeyFor(
  kind: SnapshotKind,
  id: string,
  artifacts: readonly SnapshotArtifact[],
): string {
  const matches = artifacts.filter((artifact) => (
    artifact.kind === kind
    && compareText(artifact.firstObjectId, id) <= 0
    && compareText(id, artifact.lastObjectId) <= 0
  ))
  if (matches.length !== 1) throw new Error(`Expected one data shard for ${kind} ${id}`)
  return matches[0]?.key ?? ''
}

function encodeEntry(indexKind: SnapshotIndexKind, term: string, value: unknown): EncodedIndexEntry {
  const sortKey = canonicalJson({ schemaVersion: 1, indexKind, term, value })
  return { term, sortKey, line: utf8(`${sortKey}\n`) }
}

function indexedObjects(options: {
  dataArtifacts: readonly SnapshotArtifact[]
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
}): IndexedObject[] {
  const seen = new Set<string>()
  const map = (kind: SnapshotKind, values: readonly ScannedLedgerObject[]) => values.map((value) => {
    if (seen.has(value.index)) throw new Error(`Duplicate object identifier ${value.index}`)
    seen.add(value.index)
    return {
      value,
      reference: {
        id: value.index,
        kind,
        dataKey: dataKeyFor(kind, value.index, options.dataArtifacts),
      },
    }
  })
  return [
    ...map('vault', options.vaults),
    ...map('loan-broker', options.loanBrokers),
    ...map('loan', options.loans),
  ]
}

export function buildSnapshotIndexEntries(options: {
  dataArtifacts: readonly SnapshotArtifact[]
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
}): Record<SnapshotIndexKind, EncodedIndexEntry[]> {
  const objects = indexedObjects(options)
  const objectId = objects.map(({ reference }) => encodeEntry('object-id', reference.id, reference))
  const account: EncodedIndexEntry[] = []
  const relationship: EncodedIndexEntry[] = []

  for (const { value, reference } of objects) {
    for (const field of ['Account', 'Owner', 'Borrower'] as const) {
      const accountId = stringField(value, field)
      if (accountId) account.push(encodeEntry('account', accountId, { field, reference }))
    }
    if (reference.kind === 'loan-broker') {
      const vaultId = stringField(value, 'VaultID')
      if (vaultId) relationship.push(encodeEntry('relationship', vaultId, {
        relation: 'vault-loan-broker',
        source: { id: vaultId, kind: 'vault' },
        target: reference,
      }))
    }
    if (reference.kind === 'loan') {
      const brokerId = stringField(value, 'LoanBrokerID')
      if (brokerId) relationship.push(encodeEntry('relationship', brokerId, {
        relation: 'loan-broker-loan',
        source: { id: brokerId, kind: 'loan-broker' },
        target: reference,
      }))
    }
  }

  const search = [
    ...objects.map(({ reference }) => encodeEntry('search', reference.id, {
      category: 'object-id',
      reference,
    })),
    ...[...new Set(account.map((entry) => entry.term))].map((term) => encodeEntry('search', term, {
      category: 'account',
      account: term,
    })),
  ]
  return { 'object-id': objectId, account, relationship, search }
}
