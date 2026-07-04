import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import {
  GithubCurrentStateReadModelReader,
  type ReadModelBrokerRecord,
  type ReadModelKind,
  type ReadModelLoanRecord,
} from '../../shared/current-state/github-read-model-reader'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { RuntimeConfig } from '../../shared/runtime-config'
import { getActiveSnapshot, type ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'

type Projection = VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection

type AdapterListOptions = {
  limit: number
  cursor?: string
  maxAssetReads?: number
  direction: 'asc' | 'desc'
}

function fakeRecord(kind: ReadModelKind, projection: Projection): ReleaseNativeDataRecord {
  return {
    schemaVersion: 1,
    segmentId: 'read-model',
    sourcePage: 0,
    id: projection.id,
    kind,
    valueSha256: '0'.repeat(64),
    value: { __readModelProjection: projection } as unknown as Record<string, unknown>,
  }
}

function projectionFromPage(kind: ReadModelKind, item: unknown): Projection {
  if (kind === 'vault') return item as VaultCurrentProjection
  if (kind === 'loan-broker') return (item as ReadModelBrokerRecord).broker
  return (item as ReadModelLoanRecord).loan
}

function createReadModelAdapter(readModel: GithubCurrentStateReadModelReader) {
  const cache = new Map<string, { kind: ReadModelKind; projection: Projection }>()

  function remember(kind: ReadModelKind, projection: Projection): void {
    cache.set(projection.id, { kind, projection })
  }

  function rememberPageItem(kind: ReadModelKind, item: unknown): void {
    if (kind === 'vault') {
      remember('vault', item as VaultCurrentProjection)
      return
    }
    if (kind === 'loan-broker') {
      const record = item as ReadModelBrokerRecord
      remember('loan-broker', record.broker)
      remember('vault', record.vault)
      return
    }
    const record = item as ReadModelLoanRecord
    remember('loan', record.loan)
    remember('loan-broker', record.broker)
    remember('vault', record.vault)
  }

  async function loadAny(objectId: string): Promise<{ kind: ReadModelKind; projection: Projection } | null> {
    const id = objectId.toUpperCase()
    const cached = cache.get(id)
    if (cached) return cached

    for (const kind of ['vault', 'loan-broker', 'loan'] as const) {
      try {
        if (kind === 'vault') {
          const item = await readModel.get<VaultCurrentProjection>(id, kind)
          if (item) {
            remember(kind, item)
            return { kind, projection: item }
          }
        } else if (kind === 'loan-broker') {
          const item = await readModel.get<ReadModelBrokerRecord>(id, kind)
          if (item) {
            rememberPageItem(kind, item)
            return { kind, projection: item.broker }
          }
        } else {
          const item = await readModel.get<ReadModelLoanRecord>(id, kind)
          if (item) {
            rememberPageItem(kind, item)
            return { kind, projection: item.loan }
          }
        }
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('object kind mismatch')) throw error
      }
    }
    return null
  }

  return {
    async listObjects(
      kind: ReadModelKind,
      options: AdapterListOptions,
      predicate?: (record: ReleaseNativeDataRecord) => boolean,
    ) {
      const result = await readModel.list<unknown>(kind, {
        limit: options.limit,
        cursor: options.cursor,
        direction: options.direction,
        scope: `${kind}:${options.direction}`,
        maxPageReads: Math.max(1, Math.min(options.maxAssetReads ?? 4, 4)),
        predicate: (item) => {
          rememberPageItem(kind, item)
          const projection = projectionFromPage(kind, item)
          return predicate ? predicate(fakeRecord(kind, projection)) : true
        },
      })
      return {
        items: result.items.map((item) => fakeRecord(kind, projectionFromPage(kind, item))),
        nextCursor: result.nextCursor,
        assetReads: result.pageReads,
      }
    },

    async getObject(objectId: string, _options: { maxAssetReads: number }) {
      const found = await loadAny(objectId)
      return {
        item: found ? fakeRecord(found.kind, found.projection) : null,
        complete: true,
        assetReads: found ? 2 : 1,
      }
    },
  }
}

export interface ReleaseCurrentStateSource {
  kind: 'release'
  readModel: GithubCurrentStateReadModelReader
  opened: {
    manifest: GithubCurrentStateReadModelReader['manifest']
    reader: ReturnType<typeof createReadModelAdapter>
  }
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

export function normalizeReleaseRecord(record: ReleaseNativeDataRecord): Projection {
  const projection = record.value.__readModelProjection
  if (!projection || typeof projection !== 'object') {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'read-model projection is unavailable')
  }
  return projection as Projection
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
    const reader = createReadModelAdapter(readModel)
    return {
      source: {
        kind: 'release',
        readModel,
        opened: { manifest, reader },
      },
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
