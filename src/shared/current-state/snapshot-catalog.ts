import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from './canonical-json'
import type { PageArtifactManifest } from './page-artifact-types'
import type { SnapshotIndexDescriptor, SnapshotIndexKind } from './snapshot-index-types'
import type { SnapshotIdentity, SnapshotShardDescriptor } from './snapshot-types'

export type SnapshotCatalogKind = 'data' | SnapshotIndexKind
export type SnapshotCatalogValue = SnapshotShardDescriptor | SnapshotIndexDescriptor

export interface SnapshotCatalogEntry {
  schemaVersion: 1
  catalogKind: SnapshotCatalogKind
  firstTerm: string
  lastTerm: string
  value: SnapshotCatalogValue
}

export interface SnapshotCatalogDescriptor {
  key: string
  catalogKind: SnapshotCatalogKind
  chunkSequence: number
  entryCount: number
  firstTerm: string
  lastTerm: string
  uncompressedBytes: number
  compressedBytes: number
  uncompressedSha256: string
  sha256: string
}

export interface SnapshotCatalogArtifact extends SnapshotCatalogDescriptor {
  bytes: Uint8Array
}

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

function token(value: number): string {
  return String(value).padStart(4, '0')
}

function encodeEntry(entry: SnapshotCatalogEntry): Uint8Array {
  return utf8(`${canonicalJson(entry)}\n`)
}

function concatenate(entries: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(entries.reduce((total, entry) => total + entry.byteLength, 0))
  let offset = 0
  for (const entry of entries) {
    bytes.set(entry, offset)
    offset += entry.byteLength
  }
  return bytes
}

function groupEntries(
  entries: readonly SnapshotCatalogEntry[],
  maxEntries: number,
  maxBytes: number,
): SnapshotCatalogEntry[][] {
  const groups: SnapshotCatalogEntry[][] = []
  let current: SnapshotCatalogEntry[] = []
  let currentBytes = 0
  for (const entry of entries) {
    const size = encodeEntry(entry).byteLength
    if (size > maxBytes) throw new Error(`Catalog entry ${entry.value.key} exceeds shard limit`)
    if (current.length > 0 && (current.length >= maxEntries || currentBytes + size > maxBytes)) {
      groups.push(current)
      current = []
      currentBytes = 0
    }
    current.push(entry)
    currentBytes += size
  }
  if (current.length > 0) groups.push(current)
  return groups
}

function catalogEntries(pages: readonly PageArtifactManifest[]): Record<SnapshotCatalogKind, SnapshotCatalogEntry[]> {
  const result: Record<SnapshotCatalogKind, SnapshotCatalogEntry[]> = {
    data: [],
    'object-id': [],
    account: [],
    relationship: [],
    search: [],
  }
  for (const page of pages) {
    for (const descriptor of page.dataShards) {
      result.data.push({
        schemaVersion: 1,
        catalogKind: 'data',
        firstTerm: descriptor.kind,
        lastTerm: descriptor.kind,
        value: descriptor,
      })
    }
    for (const descriptor of page.indexShards) {
      result[descriptor.indexKind].push({
        schemaVersion: 1,
        catalogKind: descriptor.indexKind,
        firstTerm: descriptor.firstTerm,
        lastTerm: descriptor.lastTerm,
        value: descriptor,
      })
    }
  }
  for (const entries of Object.values(result)) {
    entries.sort((left, right) => (
      compareText(left.firstTerm, right.firstTerm)
      || compareText(left.lastTerm, right.lastTerm)
      || compareText(left.value.key, right.value.key)
    ))
  }
  return result
}

function maximumLastTerm(group: readonly SnapshotCatalogEntry[]): string {
  return group.reduce((maximum, entry) => (
    compareText(entry.lastTerm, maximum) > 0 ? entry.lastTerm : maximum
  ), '')
}

export async function buildSnapshotCatalogArtifacts(options: {
  identity: SnapshotIdentity
  pages: readonly PageArtifactManifest[]
  maxEntriesPerShard?: number
  maxUncompressedBytes?: number
}): Promise<SnapshotCatalogArtifact[]> {
  const maxEntries = options.maxEntriesPerShard ?? DEFAULT_MAX_ENTRIES
  const maxBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error('maxEntriesPerShard must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxUncompressedBytes must be a positive safe integer')
  }

  const artifacts: SnapshotCatalogArtifact[] = []
  for (const [catalogKind, entries] of Object.entries(catalogEntries(options.pages)) as Array<[
    SnapshotCatalogKind,
    SnapshotCatalogEntry[],
  ]>) {
    for (const [index, group] of groupEntries(entries, maxEntries, maxBytes).entries()) {
      const uncompressed = concatenate(group.map(encodeEntry))
      const bytes = await gzipDeterministic(uncompressed)
      const chunkSequence = index + 1
      artifacts.push({
        key: `${prefix(options.identity)}/catalogs/${catalogKind}/${token(chunkSequence)}.ndjson.gz`,
        catalogKind,
        chunkSequence,
        entryCount: group.length,
        firstTerm: group[0]?.firstTerm ?? '',
        lastTerm: maximumLastTerm(group),
        uncompressedBytes: uncompressed.byteLength,
        compressedBytes: bytes.byteLength,
        uncompressedSha256: await sha256Hex(uncompressed),
        sha256: await sha256Hex(bytes),
        bytes,
      })
    }
  }
  return artifacts.sort((left, right) => compareText(left.key, right.key))
}
