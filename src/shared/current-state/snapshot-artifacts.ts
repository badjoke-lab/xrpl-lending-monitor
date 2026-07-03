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

async function buildKindArtifacts(options: {
  identity: SnapshotIdentity
  kind: SnapshotKind
  pageSequence: number
  values: readonly ScannedLedgerObject[]
  maxObjects: number
  maxBytes: number
}): Promise<SnapshotArtifact[]> {
  const sorted = [...options.values].sort((left, right) => left.index.localeCompare(right.index))
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]?.index === sorted[index]?.index) {
      throw new Error(`Duplicate ${options.kind} object ${sorted[index]?.index ?? ''}`)
    }
  }
  const records = await Promise.all(sorted.map((value) => encodeSnapshotRecord({
    identity: options.identity,
    kind: options.kind,
    value,
  })))
  const groups = groupRecords(records, options.maxObjects, options.maxBytes)
  return Promise.all(groups.map(async (group, index) => {
    const uncompressed = concatenate(group)
    const bytes = await gzipDeterministic(uncompressed)
    const chunkSequence = index + 1
    return {
      key: `${prefix(options.identity)}/data/${options.kind}/${pageToken(options.pageSequence)}-${chunkToken(chunkSequence)}.ndjson.gz`,
      kind: options.kind,
      pageSequence: options.pageSequence,
      chunkSequence,
      objectCount: group.length,
      firstObjectId: group[0]?.id ?? '',
      lastObjectId: group[group.length - 1]?.id ?? '',
      uncompressedBytes: uncompressed.byteLength,
      compressedBytes: bytes.byteLength,
      uncompressedSha256: await sha256Hex(uncompressed),
      sha256: await sha256Hex(bytes),
      bytes,
    }
  }))
}

export async function buildPageSnapshotArtifacts(options: {
  identity: SnapshotIdentity
  pageSequence: number
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
  maxObjectsPerShard?: number
  maxUncompressedBytes?: number
}): Promise<SnapshotArtifactSet> {
  assertIdentity(options.identity)
  validateLimit(options.pageSequence, 'pageSequence')
  const maxObjects = options.maxObjectsPerShard ?? DEFAULT_MAX_OBJECTS_PER_SHARD
  const maxBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES
  validateLimit(maxObjects, 'maxObjectsPerShard')
  validateLimit(maxBytes, 'maxUncompressedBytes')

  const artifacts = (await Promise.all([
    buildKindArtifacts({ ...options, kind: 'vault', values: options.vaults, maxObjects, maxBytes }),
    buildKindArtifacts({ ...options, kind: 'loan-broker', values: options.loanBrokers, maxObjects, maxBytes }),
    buildKindArtifacts({ ...options, kind: 'loan', values: options.loans, maxObjects, maxBytes }),
  ])).flat().sort((left, right) => left.key.localeCompare(right.key))

  const shards = artifacts.map(({ bytes: _bytes, ...descriptor }) => descriptor)
  const manifestBytes = utf8(`${canonicalJson({
    schemaVersion: 1,
    identity: options.identity,
    shards,
  })}\n`)
  return {
    artifacts,
    manifestKey: `${prefix(options.identity)}/manifest.json`,
    manifestBytes,
    manifestSha256: await sha256Hex(manifestBytes),
  }
}
