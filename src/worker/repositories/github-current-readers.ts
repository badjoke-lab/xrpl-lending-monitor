import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ReleaseNativeDataRecord } from '../../shared/current-state/release-native-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import type { ListCurrentVaultsOptions, ListCurrentVaultsResult } from './d1-current-vault-reader'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  isReleaseCurrentStateSource,
  normalizeReleaseRecord,
  type CurrentStateStorage,
  type ReleaseCurrentStateSource,
} from './release-current-state'

const MAX_LIST_ASSET_READS = 16
const MAX_REQUEST_ASSET_READS = 512

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

function queryMatches(values: readonly string[], query: string | undefined): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return values.some((value) => value.toLowerCase().includes(needle))
}

function vaultMatches(record: ReleaseNativeDataRecord, options: ListCurrentVaultsOptions): boolean {
  const vault = normalizeReleaseRecord(record) as VaultCurrentProjection
  return queryMatches([vault.id, vault.owner, vault.account, vault.asset.key], options.query)
    && (options.hasLoss === undefined || (vault.lossUnrealized !== '0') === options.hasLoss)
}

export async function listGithubVaults(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentVaultsOptions,
): Promise<ListCurrentVaultsResult> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const result = await source.opened.reader.listObjects('vault', {
    limit: options.limit,
    cursor: options.cursor,
    maxAssetReads: MAX_LIST_ASSET_READS,
    direction: (options.sort ?? 'id_asc') === 'id_desc' ? 'desc' : 'asc',
  }, (record) => vaultMatches(record, options))
  return {
    data: result.items.map((record) => normalizeReleaseRecord(record) as VaultCurrentProjection),
    nextCursor: result.nextCursor,
    shardsRead: result.assetReads,
    objectsExamined: result.items.length,
  }
}

export async function getGithubVaultById(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
): Promise<VaultCurrentProjection | null> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const found = await source.opened.reader.getObject(vaultId.toUpperCase(), { maxAssetReads: MAX_REQUEST_ASSET_READS })
  if (!found.complete) throw new CurrentStateObjectReadError('relationship_read_limit', 'asset read limit exceeded')
  if (!found.item) return null
  if (found.item.kind !== 'vault') throw new CurrentStateObjectReadError('manifest_integrity_error', 'object kind mismatch')
  return normalizeReleaseRecord(found.item) as VaultCurrentProjection
}
