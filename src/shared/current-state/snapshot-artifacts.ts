import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from './canonical-json'
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
