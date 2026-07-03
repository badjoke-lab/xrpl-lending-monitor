import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from './canonical-json'
import { encodeSnapshotRecord } from './record-codec'
import type {
  SnapshotArtifact,
  SnapshotArtifactSet,
  SnapshotIdentity,
  SnapshotKind,
} from './snapshot-types'

const DEFAULT_MAX_OBJECTS_PER_SHARD = 1_000
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024

function prefix(identity: SnapshotIdentity): string {
  return `current-state/${identity.network}/${identity.epochId}/${identity.snapshotId}`
}

function pageToken(value: number): string {
  return String(value).padStart(8, '0')
}

function chunkToken(value: number): string {
  return String(value).padStart(4, '0')
}

function assertIdentity(identity: SnapshotIdentity): void {
  if (identity.epochId.length === 0 || identity.snapshotId.length === 0) {
    throw new Error('Snapshot identity fields must not be empty')
  }
  if (!Number.isSafeInteger(identity.ledgerIndex) || identity.ledgerIndex < 0) {
    throw new Error('ledgerIndex must be a non-negative safe integer')
  }
  if (!/^[A-F0-9]{64}$/.test(identity.ledgerHash)) {
    throw new Error('ledgerHash must be 64 uppercase hexadecimal characters')
  }
}

function validateLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

interface EncodedRecord {
  id: string
  line: Uint8Array
}

function concatenate(records: readonly EncodedRecord[]): Uint8Array {
  const size = records.reduce((total, record) => total + record.line.byteLength, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const record of records) {
    bytes.set(record.line, offset)
    offset += record.line.byteLength
  }
  return bytes
}

function groupRecords(
  records: readonly EncodedRecord[],
  maxObjects: number,
  maxBytes: number,
): EncodedRecord[][] {
  const groups: EncodedRecord[][] = []
  let current: EncodedRecord[] = []
  let currentBytes = 0
  for (const record of records) {
    if (record.line.byteLength > maxBytes) throw new Error(`Object ${record.id} exceeds shard limit`)
    if (current.length > 0 && (current.length >= maxObjects || currentBytes + record.line.byteLength > maxBytes)) {
      groups.push(current)
      current = []
      currentBytes = 0
    }
    current.push(record)
    currentBytes += record.line.byteLength
  }
  if (current.length > 0) groups.push(current)
  return groups
}
