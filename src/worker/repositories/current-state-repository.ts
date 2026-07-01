import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { NormalizedCurrentState } from '../../collector/current-state/normalize-current-state'
import type { CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'

export interface CurrentSnapshotIdentity {
  id: string
  network: 'devnet'
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  endpoint: string
  startedAt: string
}

function vaultStatement(
  db: D1Database,
  snapshot: CurrentSnapshotIdentity,
  value: VaultCurrentProjection,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO vaults_current (
        snapshot_id, network, epoch_id, vault_id, owner, account,
        asset_type, asset_key, asset_json, assets_total, assets_available,
        assets_maximum, loss_unrealized, share_mpt_id, domain_id,
        withdrawal_policy, scale, flags, data_hex, previous_tx_hash,
        previous_ledger_index, raw_json
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
        ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
      )`,
    )
    .bind(
      snapshot.id,
      snapshot.network,
      snapshot.epochId,
      value.id,
      value.owner,
      value.account,
      value.asset.type,
      value.asset.key,
      JSON.stringify(value.asset),
      value.assetsTotal,
      value.assetsAvailable,
      value.assetsMaximum,
      value.lossUnrealized,
      value.shareMptId,
      value.domainId,
      value.withdrawalPolicy,
      value.scale,
      value.flags,
      value.dataHex,
      value.previousTxHash,
      value.previousLedgerIndex,
      JSON.stringify(value.raw),
    )
}

function brokerStatement(
  db: D1Database,
  snapshot: CurrentSnapshotIdentity,
  value: LoanBrokerCurrentProjection,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO loan_brokers_current (
        snapshot_id, network, epoch_id, loan_broker_id, vault_id, owner,
        account, sequence, loan_sequence, management_fee_rate, owner_count,
        debt_total, debt_maximum, cover_available, cover_rate_minimum,
        cover_rate_liquidation, flags, data_hex, previous_tx_hash,
        previous_ledger_index, raw_json
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
        ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
      )`,
    )
    .bind(
      snapshot.id,
      snapshot.network,
      snapshot.epochId,
      value.id,
      value.vaultId,
      value.owner,
      value.account,
      value.sequence,
      value.loanSequence,
      value.managementFeeRate,
      value.ownerCount,
      value.debtTotal,
      value.debtMaximum,
      value.coverAvailable,
      value.coverRateMinimum,
      value.coverRateLiquidation,
      value.flags,
      value.dataHex,
      value.previousTxHash,
      value.previousLedgerIndex,
      JSON.stringify(value.raw),
    )
}

function loanStatement(
  db: D1Database,
  snapshot: CurrentSnapshotIdentity,
  value: LoanCurrentProjection,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO loans_current (
        snapshot_id, network, epoch_id, loan_id, loan_broker_id, borrower,
        loan_sequence, loan_origination_fee, loan_service_fee,
        late_payment_fee, close_payment_fee, overpayment_fee_rate,
        interest_rate, late_interest_rate, close_interest_rate,
        overpayment_interest_rate, start_date, payment_interval, grace_period,
        previous_payment_due_date, next_payment_due_date, payment_remaining,
        principal_outstanding, total_value_outstanding,
        management_fee_outstanding, periodic_payment, loan_scale,
        on_ledger_status, supports_overpayment, flags, data_hex,
        previous_tx_hash, previous_ledger_index, raw_json
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22,
        ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32,
        ?33, ?34
      )`,
    )
    .bind(
      snapshot.id,
      snapshot.network,
      snapshot.epochId,
      value.id,
      value.loanBrokerId,
      value.borrower,
      value.loanSequence,
      value.loanOriginationFee,
      value.loanServiceFee,
      value.latePaymentFee,
      value.closePaymentFee,
      value.overpaymentFeeRate,
      value.interestRate,
      value.lateInterestRate,
      value.closeInterestRate,
      value.overpaymentInterestRate,
      value.startDate,
      value.paymentInterval,
      value.gracePeriod,
      value.previousPaymentDueDate,
      value.nextPaymentDueDate,
      value.paymentRemaining,
      value.principalOutstanding,
      value.totalValueOutstanding,
      value.managementFeeOutstanding,
      value.periodicPayment,
      value.loanScale,
      value.onLedgerStatus,
      value.supportsOverpayment ? 1 : 0,
      value.flags,
      value.dataHex,
      value.previousTxHash,
      value.previousLedgerIndex,
      JSON.stringify(value.raw),
    )
}

async function runBatches(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
  batchSize: number,
): Promise<void> {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error('Current-state write batch size must be a positive integer')
  }

  for (let index = 0; index < statements.length; index += batchSize) {
    await db.batch(statements.slice(index, index + batchSize))
  }
}

export async function beginCurrentSnapshot(
  db: D1Database,
  snapshot: CurrentSnapshotIdentity,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO current_state_snapshots (
        id, network, epoch_id, status, ledger_index, ledger_hash, endpoint,
        started_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'building', ?4, ?5, ?6, ?7, ?7, ?7)`,
    )
    .bind(
      snapshot.id,
      snapshot.network,
      snapshot.epochId,
      snapshot.ledgerIndex,
      snapshot.ledgerHash,
      snapshot.endpoint,
      snapshot.startedAt,
    )
    .run()
}

export async function writeCurrentSnapshot(options: {
  db: D1Database
  snapshot: CurrentSnapshotIdentity
  state: NormalizedCurrentState
  batchSize?: number
}): Promise<void> {
  const batchSize = options.batchSize ?? 50
  await runBatches(
    options.db,
    options.state.vaults.map((value) => vaultStatement(options.db, options.snapshot, value)),
    batchSize,
  )
  await runBatches(
    options.db,
    options.state.loanBrokers.map((value) =>
      brokerStatement(options.db, options.snapshot, value),
    ),
    batchSize,
  )
  await runBatches(
    options.db,
    options.state.loans.map((value) => loanStatement(options.db, options.snapshot, value)),
    batchSize,
  )
}

export async function activateCurrentSnapshot(options: {
  db: D1Database
  snapshot: CurrentSnapshotIdentity
  metrics: CurrentStateScanMetrics
  completedAt: string
}): Promise<void> {
  await options.db.batch([
    options.db
      .prepare(
        `UPDATE current_state_snapshots
         SET status = 'superseded', updated_at = ?1
         WHERE network = ?2 AND epoch_id = ?3 AND status = 'active'`,
      )
      .bind(options.completedAt, options.snapshot.network, options.snapshot.epochId),
    options.db
      .prepare(
        `UPDATE current_state_snapshots
         SET status = 'active', page_count = ?1, request_count = ?2,
             object_count = ?3, duration_ms = ?4, completed_at = ?5,
             updated_at = ?5
         WHERE id = ?6 AND status = 'building'`,
      )
      .bind(
        options.metrics.pages,
        options.metrics.requests,
        options.metrics.objects,
        options.metrics.elapsedMs,
        options.completedAt,
        options.snapshot.id,
      ),
    options.db
      .prepare(
        `UPDATE sync_state
         SET last_processed_ledger = ?1, last_processed_hash = ?2,
             updated_at = ?3
         WHERE network = ?4 AND epoch_id = ?5`,
      )
      .bind(
        options.snapshot.ledgerIndex,
        options.snapshot.ledgerHash,
        options.completedAt,
        options.snapshot.network,
        options.snapshot.epochId,
      ),
  ])
}

export async function failCurrentSnapshot(options: {
  db: D1Database
  snapshotId: string
  failedAt: string
  code: string
  message: string
}): Promise<void> {
  await options.db
    .prepare(
      `UPDATE current_state_snapshots
       SET status = 'failed', error_code = ?1, error_message = ?2,
           completed_at = ?3, updated_at = ?3
       WHERE id = ?4 AND status = 'building'`,
    )
    .bind(options.code, options.message, options.failedAt, options.snapshotId)
    .run()
}
