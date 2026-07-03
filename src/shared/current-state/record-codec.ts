import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import { canonicalJson, sha256Hex, utf8 } from './canonical-json'
import type { SnapshotIdentity, SnapshotKind } from './snapshot-types'

export const SNAPSHOT_RECORD_SCHEMA_VERSION = 1

export interface EncodedSnapshotRecord {
  id: string
  line: Uint8Array
}

export async function encodeSnapshotRecord(options: {
  identity: SnapshotIdentity
  kind: SnapshotKind
  value: ScannedLedgerObject
}): Promise<EncodedSnapshotRecord> {
  const valueJson = canonicalJson(options.value)
  const valueSha256 = await sha256Hex(valueJson)
  return {
    id: options.value.index,
    line: utf8(`${canonicalJson({
      schemaVersion: SNAPSHOT_RECORD_SCHEMA_VERSION,
      identity: options.identity,
      kind: options.kind,
      id: options.value.index,
      valueSha256,
      value: options.value,
    })}\n`),
  }
}
