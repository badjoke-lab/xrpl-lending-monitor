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
