import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getCurrentVaultById as getStoredCurrentVaultById,
  listCurrentVaults as listStoredCurrentVaults,
  type ListCurrentVaultsOptions,
  type ListCurrentVaultsResult,
  type VaultSort,
} from './d1-current-vault-reader'

export { CurrentStateObjectReadError } from './current-state-read-error'
export type { ListCurrentVaultsOptions, ListCurrentVaultsResult, VaultSort }

function database(storage: R2Bucket | D1Database): D1Database {
  return storage as unknown as D1Database
}

export function listCurrentVaults(
  storage: R2Bucket | D1Database,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentVaultsOptions,
): Promise<ListCurrentVaultsResult> {
  return listStoredCurrentVaults(database(storage), snapshot, options)
}

export function getCurrentVaultById(
  storage: R2Bucket | D1Database,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
) {
  return getStoredCurrentVaultById(database(storage), snapshot, vaultId)
}
