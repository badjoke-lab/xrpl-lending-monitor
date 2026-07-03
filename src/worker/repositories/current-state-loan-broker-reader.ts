import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getCurrentLoanBrokerById as getStoredCurrentLoanBrokerById,
  listCurrentLoanBrokers as listStoredCurrentLoanBrokers,
  type CurrentLoanBrokerRecord,
  type ListCurrentLoanBrokersOptions,
  type ListCurrentLoanBrokersResult,
  type LoanBrokerSort,
} from './d1-current-loan-broker-reader'

export type {
  CurrentLoanBrokerRecord,
  ListCurrentLoanBrokersOptions,
  ListCurrentLoanBrokersResult,
  LoanBrokerSort,
}

function database(storage: R2Bucket | D1Database): D1Database {
  return storage as unknown as D1Database
}

export function listCurrentLoanBrokers(
  storage: R2Bucket | D1Database,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoanBrokersOptions,
): Promise<ListCurrentLoanBrokersResult> {
  return listStoredCurrentLoanBrokers(database(storage), snapshot, options)
}

export function getCurrentLoanBrokerById(
  storage: R2Bucket | D1Database,
  snapshot: ActiveSnapshotRecord,
  brokerId: string,
): Promise<CurrentLoanBrokerRecord | null> {
  return getStoredCurrentLoanBrokerById(database(storage), snapshot, brokerId)
}
