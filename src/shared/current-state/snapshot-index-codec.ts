import { gzipDeterministic, sha256Hex } from './canonical-json'
import type { EncodedIndexEntry } from './snapshot-index-entries'
import type { SnapshotIndexArtifact, SnapshotIndexKind } from './snapshot-index-types'
import type { SnapshotIdentity } from './snapshot-types'

const DEFAULT_MAX_ENTRIES = 5_000
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function prefix(identity: SnapshotIdentity): string {
  return `current-state/${identity.network}/${identity.epochId}/${identity.snapshotId}`
}

function token(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function concatenate(entries: readonly EncodedIndexEntry[]): Uint8Array {
  const size = entries.reduce((total, entry) => total + entry.line.byteLength, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const entry of entries) {
    bytes.set(entry.line, offset)
    offset += entry.line.byteLength
  }
  return bytes
}

function validateLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function groupEntries(
  entries: readonly EncodedIndexEntry[],
  maxEntries: number,
  maxBytes: number,
): EncodedIndexEntry[][] {
  const groups: EncodedIndexEntry[][] = []
  let current: EncodedIndexEntry[] = []
  let currentBytes = 0
  for (const entry of entries) {
    if (entry.line.byteLength > maxBytes) throw new Error(`Index term ${entry.term} exceeds shard limit`)
    const close = current.length > 0 && (
      current.length >= maxEntries
      || currentBytes + entry.line.byteLength > maxBytes
    )
    if (close) {
      groups.push(current)
      current = []
      currentBytes = 0
    }
    current.push(entry)
    currentBytes += entry.line.byteLength
  }
  if (current.length > 0) groups.push(current)
  return groups
}

export async function buildSnapshotIndexArtifacts(options: {
  identity: SnapshotIdentity
  pageSequence: number
  indexKind: SnapshotIndexKind
  entries: readonly EncodedIndexEntry[]
  maxEntriesPerShard?: number
  maxUncompressedBytes?: number
}): Promise<SnapshotIndexArtifact[]> {
  const maxEntries = options.maxEntriesPerShard ?? DEFAULT_MAX_ENTRIES
  const maxBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES
  validateLimit(maxEntries, 'maxEntriesPerShard')
  validateLimit(maxBytes, 'maxUncompressedBytes')

  const sorted = [...options.entries].sort((left, right) => (
    compareText(left.term, right.term) || compareText(left.sortKey, right.sortKey)
  ))
  const unique = sorted.filter((entry, index) => entry.sortKey !== sorted[index - 1]?.sortKey)
  const artifacts: SnapshotIndexArtifact[] = []

  for (const [index, entries] of groupEntries(unique, maxEntries, maxBytes).entries()) {
    const uncompressed = concatenate(entries)
    const bytes = await gzipDeterministic(uncompressed)
    const chunkSequence = index + 1
    artifacts.push({
      key: `${prefix(options.identity)}/indexes/${options.indexKind}/${token(options.pageSequence, 8)}-${token(chunkSequence, 4)}.ndjson.gz`,
      indexKind: options.indexKind,
      pageSequence: options.pageSequence,
      chunkSequence,
      entryCount: entries.length,
      firstTerm: entries[0]?.term ?? '',
      lastTerm: entries[entries.length - 1]?.term ?? '',
      uncompressedBytes: uncompressed.byteLength,
      compressedBytes: bytes.byteLength,
      uncompressedSha256: await sha256Hex(uncompressed),
      sha256: await sha256Hex(bytes),
      bytes,
    })
  }
  return artifacts
}
