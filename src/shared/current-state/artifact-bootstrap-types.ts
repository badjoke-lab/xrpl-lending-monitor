import type { CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import type { SnapshotIdentity } from './snapshot-types'

export interface ArtifactBootstrapIdentity extends SnapshotIdentity {
  endpoint: string
}

export interface PageManifestReference {
  pageSequence: number
  key: string
  sha256: string
}

export interface ArtifactBootstrapCheckpoint extends ArtifactBootstrapIdentity {
  schemaVersion: 1
  nextMarker: unknown
  nextPageSequence: number
  scanComplete: boolean
  metrics: CurrentStateScanMetrics
  pageManifests: PageManifestReference[]
}

export interface ArtifactBootstrapCheckpointStore {
  load(snapshotId: string): Promise<ArtifactBootstrapCheckpoint | null>
  save(checkpoint: ArtifactBootstrapCheckpoint): Promise<void>
}

export interface ArtifactBootstrapResult {
  status: 'paused' | 'complete'
  checkpoint: ArtifactBootstrapCheckpoint
}

export class InMemoryArtifactBootstrapCheckpointStore
implements ArtifactBootstrapCheckpointStore {
  readonly #checkpoints = new Map<string, ArtifactBootstrapCheckpoint>()

  async load(snapshotId: string): Promise<ArtifactBootstrapCheckpoint | null> {
    const checkpoint = this.#checkpoints.get(snapshotId)
    return checkpoint ? structuredClone(checkpoint) : null
  }

  async save(checkpoint: ArtifactBootstrapCheckpoint): Promise<void> {
    this.#checkpoints.set(checkpoint.snapshotId, structuredClone(checkpoint))
  }
}
