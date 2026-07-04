import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getCurrentLoanBrokerById as getStoredCurrentLoanBrokerById,
  listCurrentLoanBrokers as listStoredCurrentLoanBrokers,
  type CurrentLoanBrokerRecord,
  type ListCurrentLoanBrokersOptions,
  type ListCurrentLoanBrokersResult,
  type LoanBrokerSort,
} from './d1-current-loan-broker-reader'
import {
  getBaseOverlayLoanBrokerById,
  listBaseOverlayLoanBrokers,
} from './base-overlay-loan-broker-reader'
import {
  isReleaseCurrentStateSource,
  type CurrentStateStorage,
} from './release-current-state'

export type {
  CurrentLoanBrokerRecord,
  ListCurrentLoanBrokersOptions,
  ListCurrentLoanBrokersResult,
  LoanBrokerSort,
}

function database(storage: CurrentStateStorage): D1Database {
  return storage as unknown as D1Database
}

export function listCurrentLoanBrokers(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoanBrokersOptions,
): Promise<ListCurrentLoanBrokersResult> {
  return isReleaseCurrentStateSource(storage)
    ? listBaseOverlayLoanBrokers(storage.db, storage, snapshot, options)
    : listStoredCurrentLoanBrokers(database(storage), snapshot, options)
}

export function getCurrentLoanBrokerById(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  brokerId: string,
): Promise<CurrentLoanBrokerRecord | null> {
  return isReleaseCurrentStateSource(storage)
    ? getBaseOverlayLoanBrokerById(storage.db, storage, snapshot, brokerId)
    : getStoredCurrentLoanBrokerById(database(storage), snapshot, brokerId)
}
