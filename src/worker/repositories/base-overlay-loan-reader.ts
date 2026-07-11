import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import type {
  CurrentLoanRecord,
  ListCurrentLoansOptions,
  ListCurrentLoansResult,
  LoanScheduleEvaluation,
} from './d1-current-loan-reader'
import {
  getThreeLayerCurrentProjection as getResolvedCurrentProjection,
  getThreeLayerCurrentProjections as getResolvedCurrentProjections,
  listThreeLayerCurrentProjections as listResolvedCurrentProjections,
} from './three-layer-current-reader'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  isReleaseCurrentStateSource,
  type CurrentStateStorage,
  type ReleaseCurrentStateSource,
} from './release-current-state'

const MAX_LIST_ASSET_READS = 16

type RelatedProjection = LoanBrokerCurrentProjection | LoanCurrentProjection | VaultCurrentProjection

type RelatedProjectionMap = Map<string, RelatedProjection | null>

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

function evaluateSchedule(
  loan: LoanCurrentProjection,
  evaluatedAtRippleTime: number,
): LoanScheduleEvaluation {
  if (!Number.isSafeInteger(evaluatedAtRippleTime) || evaluatedAtRippleTime < 0) {
    throw new Error('evaluatedAtRippleTime must be a non-negative safe integer')
  }
  if (loan.paymentRemaining === 0) {
    return {
      status: 'complete',
      evaluatedAtRippleTime,
      nextPaymentDueRippleTime: loan.nextPaymentDueDate,
      defaultEligibleRippleTime: null,
    }
  }
  if (loan.nextPaymentDueDate === null) {
    return {
      status: 'unknown',
      evaluatedAtRippleTime,
      nextPaymentDueRippleTime: null,
      defaultEligibleRippleTime: null,
    }
  }
  const defaultEligibleRippleTime = loan.nextPaymentDueDate + loan.gracePeriod
  return {
    status: evaluatedAtRippleTime < loan.nextPaymentDueDate
      ? 'current'
      : evaluatedAtRippleTime < defaultEligibleRippleTime
        ? 'payment_due'
        : 'default_eligible',
    evaluatedAtRippleTime,
    nextPaymentDueRippleTime: loan.nextPaymentDueDate,
    defaultEligibleRippleTime,
  }
}

function matches(loan: LoanCurrentProjection, options: ListCurrentLoansOptions): boolean {
  const query = options.query?.toLowerCase()
  const queryMatches = !query || [loan.id, loan.loanBrokerId, loan.borrower]
    .some((value) => value.toLowerCase().includes(query))
  const schedule = evaluateSchedule(loan, options.evaluatedAtRippleTime)
  return queryMatches
    && (options.onLedgerStatus === undefined || loan.onLedgerStatus === options.onLedgerStatus)
    && (options.scheduleStatus === undefined || schedule.status === options.scheduleStatus)
}

function requiredBroker(
  brokers: RelatedProjectionMap,
  brokerId: string,
): LoanBrokerCurrentProjection {
  const found = brokers.get(brokerId.toUpperCase())
  if (!found || found.kind !== 'loan_broker') {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'Loan Broker relationship is missing')
  }
  return found
}

function requiredVault(
  vaults: RelatedProjectionMap,
  vaultId: string,
): VaultCurrentProjection {
  const found = vaults.get(vaultId.toUpperCase())
  if (!found || found.kind !== 'vault') {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'Loan Vault relationship is missing')
  }
  return found
}

async function resolvedBroker(
  db: D1Database,
  source: ReleaseCurrentStateSource,
  snapshot: ActiveSnapshotRecord,
  brokerId: string,
): Promise<LoanBrokerCurrentProjection> {
  const found = await getResolvedCurrentProjection({
    db,
    source,
    snapshot,
    kind: 'loan-broker',
    objectId: brokerId,
  })
  if (!found.item) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'Loan Broker relationship is missing')
  }
  return found.item as LoanBrokerCurrentProjection
}

async function resolvedVault(
  db: D1Database,
  source: ReleaseCurrentStateSource,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
): Promise<VaultCurrentProjection> {
  const found = await getResolvedCurrentProjection({
    db,
    source,
    snapshot,
    kind: 'vault',
    objectId: vaultId,
  })
  if (!found.item) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'Loan Vault relationship is missing')
  }
  return found.item as VaultCurrentProjection
}

async function materialize(
  db: D1Database,
  source: ReleaseCurrentStateSource,
  snapshot: ActiveSnapshotRecord,
  loan: LoanCurrentProjection,
  evaluatedAtRippleTime: number,
): Promise<CurrentLoanRecord> {
  const broker = await resolvedBroker(db, source, snapshot, loan.loanBrokerId)
  const vault = await resolvedVault(db, source, snapshot, broker.vaultId)
  return {
    loan,
    broker,
    vault,
    schedule: evaluateSchedule(loan, evaluatedAtRippleTime),
  }
}

export async function listBaseOverlayLoans(
  db: D1Database,
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoansOptions,
): Promise<ListCurrentLoansResult> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)

  // Keep the release-asset scan bounded independently of filter selectivity.
  // Filtering inside the release reader can force a single request to walk a
  // large part of the immutable snapshot when matches are rare. Read one
  // bounded merged page, then apply public filters locally and let the cursor
  // continue from the end of that raw page on the next request.
  const result = await listResolvedCurrentProjections({
    db,
    source,
    snapshot,
    kind: 'loan',
    list: {
      limit: options.limit,
      cursor: options.cursor,
      direction: (options.sort ?? 'id_asc') === 'id_desc' ? 'desc' : 'asc',
      scope: [
        'loan',
        options.sort ?? 'id_asc',
        options.query ?? '',
        options.onLedgerStatus ?? '',
        options.scheduleStatus ?? '',
        options.evaluatedAtRippleTime,
      ].join(':'),
      maxBasePageReads: MAX_LIST_ASSET_READS,
    },
  })

  const loans = (result.items as LoanCurrentProjection[])
    .filter((loan) => matches(loan, options))
  const brokerResult = await getResolvedCurrentProjections({
    db,
    source,
    snapshot,
    kind: 'loan-broker',
    objectIds: loans.map((loan) => loan.loanBrokerId),
  })
  const brokers = brokerResult.items as RelatedProjectionMap
  const resolvedBrokers = loans.map((loan) => requiredBroker(brokers, loan.loanBrokerId))
  const vaultResult = await getResolvedCurrentProjections({
    db,
    source,
    snapshot,
    kind: 'vault',
    objectIds: resolvedBrokers.map((broker) => broker.vaultId),
  })
  const vaults = vaultResult.items as RelatedProjectionMap
  const data: CurrentLoanRecord[] = loans.map((loan, index) => {
    const broker = resolvedBrokers[index]!
    return {
      loan,
      broker,
      vault: requiredVault(vaults, broker.vaultId),
      schedule: evaluateSchedule(loan, options.evaluatedAtRippleTime),
    }
  })

  return {
    data,
    nextCursor: result.nextCursor,
    loanShardsRead: result.basePageReads,
    relationShardsRead: brokerResult.assetReads + vaultResult.assetReads,
    objectsExamined: result.objectsExamined,
  }
}

export async function getBaseOverlayLoanById(
  db: D1Database,
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  loanId: string,
  evaluatedAtRippleTime: number,
): Promise<CurrentLoanRecord | null> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const found = await getResolvedCurrentProjection({
    db,
    source,
    snapshot,
    kind: 'loan',
    objectId: loanId,
  })
  if (!found.item) return null
  return materialize(
    db,
    source,
    snapshot,
    found.item as LoanCurrentProjection,
    evaluatedAtRippleTime,
  )
}
