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
