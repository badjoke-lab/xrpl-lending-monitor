import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { SnapshotIndexKind } from './snapshot-index-types'
import type { SnapshotIdentity, SnapshotKind } from './snapshot-types'

export interface SnapshotRecord {
  schemaVersion: 1
  identity: SnapshotIdentity
  kind: SnapshotKind
  id: string
  valueSha256: string
  value: ScannedLedgerObject
}

export interface ObjectReference {
  id: string
  kind: SnapshotKind
  dataKey: string
}

export interface SnapshotIndexRecord<T = unknown> {
  schemaVersion: 1
  indexKind: SnapshotIndexKind
  term: string
  value: T
}

export interface BoundedReadOptions {
  limit?: number
  cursor?: string
  maxShardReads?: number
}

export interface BoundedReadResult<T> {
  items: T[]
  nextCursor: string | null
  complete: boolean
  shardReads: number
}

export interface BoundedLookupResult<T> {
  item: T | null
  complete: boolean
  shardReads: number
}

export interface AccountIndexValue {
  field: 'Account' | 'Owner' | 'Borrower'
  reference: ObjectReference
}

export interface RelationshipIndexValue {
  relation: 'vault-loan-broker' | 'loan-broker-loan'
  source: { id: string; kind: 'vault' | 'loan-broker' }
  target: ObjectReference
}

export type SearchIndexValue =
  | { category: 'object-id'; reference: ObjectReference }
  | { category: 'account'; account: string }
