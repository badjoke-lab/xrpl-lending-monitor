import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from '../../collector/current-state/normalize-current-objects'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import { openReleaseSnapshotReader, type ReleaseSnapshotReader } from '../../shared/current-state/release-reader'
import type { RuntimeConfig } from '../../shared/runtime-config'
import { getActiveSnapshot, type ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'

export interface ReleaseCurrentStateSource {
  kind: 'release'
  opened: ReleaseSnapshotReader
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
  const cache = typeof caches === 'undefined' ? undefined : await caches.open('current-state-release')
  try {
    const opened = await openReleaseSnapshotReader({
      githubRepository: config.currentState.githubRepository,
      githubBranch: 'current-state-data',
      channelTag: config.currentState.releaseChannelTag,
      cache,
      maxAssetBytes: config.currentState.maxAssetBytes,
      maxDecompressedBytes: config.currentState.maxDecompressedBytes,
    })
    const manifest = opened.manifest
    return {
      source: { kind: 'release', opened },
      snapshot: {
        id: manifest.snapshotId,
        epochId: manifest.epochId,
        ledgerIndex: manifest.ledgerIndex,
        ledgerHash: manifest.ledgerHash,
        objectPrefix: '',
        manifestKey: opened.channel.active?.manifestAssetName ?? null,
        manifestSha256: manifest.manifestSha256,
        vaultCount: manifest.counts.vaults,
        loanBrokerCount: manifest.counts.loanBrokers,
        loanCount: manifest.counts.loans,
        objectCount: manifest.relevantObjectCount,
        shardCount: manifest.dataAssets.length + manifest.indexAssets.length,
        compressedBytes: manifest.totals.dataCompressedBytes + manifest.totals.indexCompressedBytes,
        completedAt: opened.channel.updatedAt,
      },
    }
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'manifest_integrity_error',
      error instanceof Error ? error.message : 'release current-state source is invalid',
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

export function normalizeReleaseRecord(record: ReleaseNativeDataRecord): (
  VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection
) {
  const value = record.value as ScannedLedgerObject
  if (record.kind === 'vault') return normalizeVault(value)
  if (record.kind === 'loan-broker') return normalizeLoanBroker(value)
  return normalizeLoan(value)
}
