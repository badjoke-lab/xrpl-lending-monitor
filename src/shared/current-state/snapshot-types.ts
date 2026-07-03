export type SnapshotKind = 'vault' | 'loan-broker' | 'loan'

export interface SnapshotIdentity {
  network: 'devnet'
  epochId: string
  snapshotId: string
  ledgerIndex: number
  ledgerHash: string
}

export interface SnapshotShardDescriptor {
  key: string
  kind: SnapshotKind
  pageSequence: number
  chunkSequence: number
  objectCount: number
  firstObjectId: string
  lastObjectId: string
  uncompressedBytes: number
  compressedBytes: number
  uncompressedSha256: string
  sha256: string
}
