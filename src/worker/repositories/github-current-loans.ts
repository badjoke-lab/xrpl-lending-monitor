import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'
import type {
  CurrentLoanRecord,
  ListCurrentLoansOptions,
  ListCurrentLoansResult,
  LoanScheduleEvaluation,
} from './d1-current-loan-reader'
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

function queryMatches(values: readonly string[], query: string | undefined): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return values.some((value) => value.toLowerCase().includes(needle))
}

async function objectById<T>(
  source: ReleaseCurrentStateSource,
  objectId: string,
  expectedKind: 'vault' | 'loan-broker' | 'loan',
  maxAssetReads: number,
): Promise<{ item: T | null; assetReads: number }> {
  if (maxAssetReads < 1) throw new CurrentStateObjectReadError('relationship_read_limit', 'asset read limit exceeded')
  const found = await source.opened.reader.getObject(objectId, { maxAssetReads })
  if (!found.complete) throw new CurrentStateObjectReadError('relationship_read_limit', 'asset read limit exceeded')
  if (!found.item) return { item: null, assetReads: found.assetReads }
  if (found.item.kind !== expectedKind) throw new CurrentStateObjectReadError('manifest_integrity_error', 'object kind mismatch')
  return { item: normalizeReleaseRecord(found.item) as T, assetReads: found.assetReads }
}

function loanMatches(
  loan: LoanCurrentProjection,
  options: ListCurrentLoansOptions,
): boolean {
  const schedule = evaluateSchedule(loan, options.evaluatedAtRippleTime)
  return queryMatches([loan.id, loan.loanBrokerId, loan.borrower], options.query)
    && (options.onLedgerStatus === undefined || loan.onLedgerStatus === options.onLedgerStatus)
    && (options.scheduleStatus === undefined || schedule.status === options.scheduleStatus)
}

async function materializeLoanRecord(
  source: ReleaseCurrentStateSource,
  loan: LoanCurrentProjection,
  evaluatedAtRippleTime: number,
  maxAssetReads: number,
): Promise<{ item: CurrentLoanRecord; assetReads: number }> {
  const broker = await objectById<LoanBrokerCurrentProjection>(
    source,
    loan.loanBrokerId,
    'loan-broker',
    maxAssetReads,
  )
  if (!broker.item) throw new CurrentStateObjectReadError('manifest_integrity_error', 'loan broker is missing')
  const vault = await objectById<VaultCurrentProjection>(
    source,
    broker.item.vaultId,
    'vault',
    maxAssetReads - broker.assetReads,
  )
  if (!vault.item) throw new CurrentStateObjectReadError('manifest_integrity_error', 'loan vault is missing')
  return {
    item: {
      loan,
      broker: broker.item,
      vault: vault.item,
      schedule: evaluateSchedule(loan, evaluatedAtRippleTime),
    },
    assetReads: broker.assetReads + vault.assetReads,
  }
}

export async function listGithubLoans(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoansOptions,
): Promise<ListCurrentLoansResult> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const result = await source.opened.reader.listObjects('loan', {
    limit: options.limit,
    cursor: options.cursor,
    maxAssetReads: MAX_LIST_ASSET_READS,
    direction: (options.sort ?? 'id_asc') === 'id_desc' ? 'desc' : 'asc',
  }, (record) => {
    const loan = normalizeReleaseRecord(record) as LoanCurrentProjection
    return loanMatches(loan, options)
  })
  const data: CurrentLoanRecord[] = []
  let relationReads = 0
  for (const item of result.items) {
    const loan = normalizeReleaseRecord(item) as LoanCurrentProjection
    const materialized = await materializeLoanRecord(
      source,
      loan,
      options.evaluatedAtRippleTime,
      MAX_REQUEST_ASSET_READS - result.assetReads - relationReads,
    )
    relationReads += materialized.assetReads
    data.push(materialized.item)
  }
  return {
    data,
    nextCursor: result.nextCursor,
    loanShardsRead: result.assetReads,
    relationShardsRead: relationReads,
    objectsExamined: result.items.length,
  }
}

export async function getGithubLoanById(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  loanId: string,
  evaluatedAtRippleTime: number,
): Promise<CurrentLoanRecord | null> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const found = await objectById<LoanCurrentProjection>(
    source,
    loanId.toUpperCase(),
    'loan',
    MAX_REQUEST_ASSET_READS,
  )
  if (!found.item) return null
  return (await materializeLoanRecord(
    source,
    found.item,
    evaluatedAtRippleTime,
    MAX_REQUEST_ASSET_READS - found.assetReads,
  )).item
}
