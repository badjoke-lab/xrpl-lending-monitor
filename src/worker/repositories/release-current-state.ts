import { GithubCurrentStateReadModelReader } from '../../shared/current-state/github-read-model-reader'
import type { RuntimeConfig } from '../../shared/runtime-config'
import { getActiveSnapshot, type ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'

export interface ReleaseCurrentStateSource {
  kind: 'release'
  readModel: GithubCurrentStateReadModelReader
}

export type CurrentStateStorage = D1Database | ReleaseCurrentStateSource

export interface ResolvedCurrentStateStorage {
  source: CurrentStateStorage
  snapshot: ActiveSnapshotRecord | null
  releaseUnavailable: boolean
}

export function isReleaseCurrentStateSource(value: CurrentStateStorage): value is ReleaseCurrentStateSource {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'release'
}

export async function openConfiguredReleaseCurrentState(
  config: RuntimeConfig,
): Promise<{
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
} | null> {
  if (!config.currentState.githubRepository) return null
  try {
    const readModel = await GithubCurrentStateReadModelReader.open({
      githubRepository: config.currentState.githubRepository,
      githubBranch: 'current-state-data',
    })
    const manifest = readModel.manifest
    const objectCount = manifest.counts.vaults + manifest.counts.loanBrokers + manifest.counts.loans
    const shardCount = manifest.pageCounts.vaults
      + manifest.pageCounts.loanBrokers
      + manifest.pageCounts.loans
      + 16 ** manifest.lookupPrefixLength
    return {
      source: { kind: 'release', readModel },
      snapshot: {
        id: manifest.snapshotId,
        epochId: manifest.epochId,
        ledgerIndex: manifest.ledgerIndex,
        ledgerHash: manifest.ledgerHash,
        objectPrefix: 'read-model/',
        manifestKey: 'read-model/manifest.json',
        manifestSha256: manifest.manifestSha256,
        vaultCount: manifest.counts.vaults,
        loanBrokerCount: manifest.counts.loanBrokers,
        loanCount: manifest.counts.loans,
        objectCount,
        shardCount,
        compressedBytes: 0,
        completedAt: readModel.updatedAt,
      },
    }
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'manifest_integrity_error',
      error instanceof Error ? error.message : 'read-model current-state source is invalid',
    )
  }
}

export async function resolveCurrentStateStorage(
  config: RuntimeConfig,
  db: D1Database,
): Promise<ResolvedCurrentStateStorage> {
  const releaseConfigured = Boolean(config.currentState.githubRepository)
  if (releaseConfigured) {
    try {
      const release = await openConfiguredReleaseCurrentState(config)
      if (!release) return { source: db, snapshot: null, releaseUnavailable: true }
      return { source: release.source, snapshot: release.snapshot, releaseUnavailable: false }
    } catch {
      return { source: db, snapshot: null, releaseUnavailable: true }
    }
  }
  return {
    source: db,
    snapshot: await getActiveSnapshot(db),
    releaseUnavailable: false,
  }
}
