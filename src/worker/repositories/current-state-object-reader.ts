import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getCurrentVaultById as getStoredCurrentVaultById,
  listCurrentVaults as listStoredCurrentVaults,
  type ListCurrentVaultsOptions,
  type ListCurrentVaultsResult,
  type VaultSort,
} from './d1-current-vault-reader'
import {
  getGithubVaultById,
  listGithubVaults,
} from './github-current-readers'
import {
  isReleaseCurrentStateSource,
  type CurrentStateStorage,
} from './release-current-state'

export { CurrentStateObjectReadError } from './current-state-read-error'
export type { ListCurrentVaultsOptions, ListCurrentVaultsResult, VaultSort }

function database(storage: CurrentStateStorage): D1Database {
  return storage as unknown as D1Database
}

export function listCurrentVaults(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentVaultsOptions,
): Promise<ListCurrentVaultsResult> {
  return isReleaseCurrentStateSource(storage)
    ? listGithubVaults(storage, snapshot, options)
    : listStoredCurrentVaults(database(storage), snapshot, options)
}

export function getCurrentVaultById(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
) {
  return isReleaseCurrentStateSource(storage)
    ? getGithubVaultById(storage, snapshot, vaultId)
    : getStoredCurrentVaultById(database(storage), snapshot, vaultId)
}
