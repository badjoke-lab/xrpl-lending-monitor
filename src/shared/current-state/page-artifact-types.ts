import type { SnapshotIndexArtifact, SnapshotIndexDescriptor } from './snapshot-index-types'
import type {
  SnapshotArtifact,
  SnapshotIdentity,
  SnapshotShardDescriptor,
} from './snapshot-types'

export interface PageArtifactManifest {
  schemaVersion: 1
  identity: SnapshotIdentity
  pageSequence: number
  markerAfter: unknown | null
  dataShards: SnapshotShardDescriptor[]
  indexShards: SnapshotIndexDescriptor[]
  totals: {
    dataObjects: number
    indexEntries: number
    uncompressedBytes: number
    compressedBytes: number
  }
}

export interface PageArtifactSet {
  dataArtifacts: SnapshotArtifact[]
  indexArtifacts: SnapshotIndexArtifact[]
  manifest: PageArtifactManifest
  manifestKey: string
  manifestBytes: Uint8Array
  manifestSha256: string
}

export interface PageArtifactCheckpoint {
  pageSequence: number
  markerAfter: unknown | null
  manifestKey: string
  manifestSha256: string
}
