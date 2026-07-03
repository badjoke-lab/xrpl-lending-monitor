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

export interface SnapshotArtifact extends SnapshotShardDescriptor {
  bytes: Uint8Array
}

export interface SnapshotArtifactSet {
  artifacts: SnapshotArtifact[]
  manifestKey: string
  manifestBytes: Uint8Array
  manifestSha256: string
}
