import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { canonicalJson, sha256Hex, utf8 } from './canonical-json'
import type { SnapshotIdentity, SnapshotKind } from './snapshot-types'

export const SNAPSHOT_RECORD_SCHEMA_VERSION = 1

export interface EncodedSnapshotRecord {
  id: string
  line: Uint8Array
}
