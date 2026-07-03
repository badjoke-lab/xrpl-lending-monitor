export type SnapshotIndexKind = 'object-id' | 'account' | 'relationship' | 'search'

export interface SnapshotIndexDescriptor {
  key: string
  indexKind: SnapshotIndexKind
  pageSequence: number
  chunkSequence: number
  entryCount: number
  firstTerm: string
  lastTerm: string
  uncompressedBytes: number
  compressedBytes: number
  uncompressedSha256: string
  sha256: string
}

export interface SnapshotIndexArtifact extends SnapshotIndexDescriptor {
  bytes: Uint8Array
}
