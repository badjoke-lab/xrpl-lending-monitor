import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import type { ListCurrentVaultsOptions, ListCurrentVaultsResult } from './d1-current-vault-reader'
import {
  getThreeLayerCurrentProjection as getResolvedCurrentProjection,
  listThreeLayerCurrentProjections as listResolvedCurrentProjections,
} from './three-layer-current-reader'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  isReleaseCurrentStateSource,
  type CurrentStateStorage,
  type ReleaseCurrentStateSource,
} from './release-current-state'

const MAX_LIST_ASSET_READS = 16

function releaseSource(storage: CurrentStateStorage): ReleaseCurrentStateSource {
  if (!isReleaseCurrentStateSource(storage)) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'release source is unavailable')
  }
  return storage
}

function validateSnapshot(snapshot: ActiveSnapshotRecord, source: ReleaseCurrentStateSource): void {
  const manifest = source.opened.manifest
  if (
    snapshot.id !== manifest.snapshotId
    || snapshot.epochId !== manifest.epochId
    || snapshot.ledgerIndex !== manifest.ledgerIndex
    || snapshot.ledgerHash !== manifest.ledgerHash
  ) throw new CurrentStateObjectReadError('manifest_integrity_error', 'snapshot identity mismatch')
}

function matches(vault: VaultCurrentProjection, options: ListCurrentVaultsOptions): boolean {
  const query = options.query?.toLowerCase()
  const queryMatches = !query || [vault.id, vault.owner, vault.account, vault.asset.key]
    .some((value) => value.toLowerCase().includes(query))
  const lossMatches = options.hasLoss === undefined
    || (vault.lossUnrealized !== '0') === options.hasLoss
  return queryMatches && lossMatches
}

function readError(error: unknown, hasCursor: boolean): CurrentStateObjectReadError {
  if (error instanceof CurrentStateObjectReadError) return error
  const message = error instanceof Error ? error.message : 'current-state read failed'
  return new CurrentStateObjectReadError(
    hasCursor || message.toLowerCase().includes('cursor') ? 'invalid_cursor' : 'manifest_integrity_error',
    message,
  )
}

export async function listBaseOverlayVaults(
  db: D1Database,
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentVaultsOptions,
): Promise<ListCurrentVaultsResult> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  try {
    const result = await listResolvedCurrentProjections({
      db,
      source,
      snapshot,
      kind: 'vault',
      list: {
        limit: options.limit,
        cursor: options.cursor,
        direction: (options.sort ?? 'id_asc') === 'id_desc' ? 'desc' : 'asc',
        scope: `vault:${options.sort ?? 'id_asc'}:${options.query ?? ''}:${String(options.hasLoss ?? '')}`,
        maxBasePageReads: MAX_LIST_ASSET_READS,
        predicate: (projection) => matches(projection as VaultCurrentProjection, options),
      },
    })
    return {
      data: result.items as VaultCurrentProjection[],
      nextCursor: result.nextCursor,
      shardsRead: result.basePageReads,
      objectsExamined: result.objectsExamined,
    }
  } catch (error) {
    throw readError(error, options.cursor !== undefined)
  }
}

export async function getBaseOverlayVaultById(
  db: D1Database,
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
): Promise<VaultCurrentProjection | null> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  try {
    const result = await getResolvedCurrentProjection({
      db,
      source,
      snapshot,
      kind: 'vault',
      objectId: vaultId,
    })
    return result.item as VaultCurrentProjection | null
  } catch (error) {
    throw readError(error, false)
  }
}
