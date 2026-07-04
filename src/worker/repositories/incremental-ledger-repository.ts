import { deriveArchivedObjects } from '../../collector/incremental/deleted-object-archive'
import { deriveBalanceHistory } from '../../collector/incremental/cover-debt-loss'
import { deriveCurrentStateOverlayMutations } from '../../collector/incremental/current-state-overlay'
import { normalizeAffectedNodes } from '../../collector/incremental/affected-nodes'
import { deriveLoanLifecycleEvents } from '../../collector/incremental/loan-lifecycle'
import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import {
  assertCurrentStateOverlayBase,
  type CurrentStateOverlayBaseIdentity,
  type CurrentStateOverlayMutation,
} from './current-state-overlay'

interface CursorRow {
  epoch_id: string | null
  last_processed_ledger: number | null
  last_processed_hash: string | null
}

export type IncrementalCommitStatus = 'empty' | 'committed' | 'already_committed'

function commitToken(options: {
  epochId: string
  expectedPreviousLedger: number
  expectedPreviousHash: string
  finalLedgerIndex: number
  finalLedgerHash: string
}): string {
  return [
    'incremental',
    options.epochId,
    options.expectedPreviousLedger,
    options.expectedPreviousHash,
    options.finalLedgerIndex,
    options.finalLedgerHash,
  ].join(':')
}

function assertScanChain(options: {
  scan: IncrementalScanResult
  expectedPreviousLedger: number
  expectedPreviousHash: string
}): void {
  const first = options.scan.ledgers[0]
  if (!first) return
  if (first.ledgerIndex !== options.expectedPreviousLedger + 1) {
    throw new Error('Incremental scan does not begin immediately after the committed cursor')
  }
  if (first.parentHash !== options.expectedPreviousHash) {
    throw new Error('Incremental scan does not extend the committed ledger hash')
  }
  for (let index = 1; index < options.scan.ledgers.length; index += 1) {
    const previous = options.scan.ledgers[index - 1]
    const current = options.scan.ledgers[index]
    if (!previous || !current) throw new Error('Incremental scan ledger sequence is incomplete')
    if (current.ledgerIndex !== previous.ledgerIndex + 1) {
      throw new Error('Incremental scan contains a ledger index gap')
    }
    if (current.parentHash !== previous.ledgerHash) {
      throw new Error('Incremental scan contains a ledger hash discontinuity')
    }
  }
}

async function readCursor(db: D1Database): Promise<CursorRow | null> {
  return db
    .prepare(
      `SELECT epoch_id, last_processed_ledger, last_processed_hash
       FROM sync_state
       WHERE network = ?1`,
    )
    .bind('devnet')
    .first<CursorRow>()
}

function overlayGuardStatement(options: {
  db: D1Database
  token: string
  base: CurrentStateOverlayBaseIdentity
  expectedOverlayLedgerIndex: number
  expectedOverlayLedgerHash: string
  checkedAt: string
}): D1PreparedStatement {
  return options.db
    .prepare(
      `INSERT INTO current_state_overlay_commit_guards (
         commit_token, network, epoch_id, base_snapshot_id,
         expected_base_ledger_index, expected_base_ledger_hash,
         observed_base_ledger_index, observed_base_ledger_hash,
         expected_overlay_ledger_index, expected_overlay_ledger_hash,
         observed_overlay_ledger_index, observed_overlay_ledger_hash,
         checked_at
       ) VALUES (
         ?1, 'devnet', ?2, ?3,
         ?4, ?5,
         (
           SELECT base_ledger_index
           FROM current_state_overlay_state
           WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3
         ),
         (
           SELECT base_ledger_hash
           FROM current_state_overlay_state
           WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3
         ),
         ?6, ?7,
         (
           SELECT overlay_ledger_index
           FROM current_state_overlay_state
           WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3
         ),
         (
           SELECT overlay_ledger_hash
           FROM current_state_overlay_state
           WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3
         ),
         ?8
       )`,
    )
    .bind(
      options.token,
      options.base.epochId,
      options.base.baseSnapshotId,
      options.base.baseLedgerIndex,
      options.base.baseLedgerHash,
      options.expectedOverlayLedgerIndex,
      options.expectedOverlayLedgerHash,
      options.checkedAt,
    )
}

function overlayMutationStatement(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  mutation: CurrentStateOverlayMutation
  ledgerIndex: number
  ledgerHash: string
  transactionHash: string
  transactionIndex: number
  updatedAt: string
}): D1PreparedStatement {
  const projection = options.mutation.operation === 'upsert' ? options.mutation.projectionJson : null
  const links = options.mutation.relationships ?? {}
  return options.db
    .prepare(
      `INSERT INTO current_state_overlay_objects (
         network, epoch_id, base_snapshot_id, object_type, object_id, operation,
         projection_json, owner, account, borrower, vault_id, loan_broker_id,
         asset_key, on_ledger_status, source_ledger_index, source_ledger_hash,
         source_transaction_hash, source_transaction_index, updated_at
       ) VALUES (
         'devnet', ?1, ?2, ?3, ?4, ?5,
         ?6, ?7, ?8, ?9, ?10, ?11,
         ?12, ?13, ?14, ?15,
         ?16, ?17, ?18
       )
       ON CONFLICT(network, epoch_id, base_snapshot_id, object_type, object_id)
       DO UPDATE SET
         operation = excluded.operation,
         projection_json = excluded.projection_json,
         owner = excluded.owner,
         account = excluded.account,
         borrower = excluded.borrower,
         vault_id = excluded.vault_id,
         loan_broker_id = excluded.loan_broker_id,
         asset_key = excluded.asset_key,
         on_ledger_status = excluded.on_ledger_status,
         source_ledger_index = excluded.source_ledger_index,
         source_ledger_hash = excluded.source_ledger_hash,
         source_transaction_hash = excluded.source_transaction_hash,
         source_transaction_index = excluded.source_transaction_index,
         updated_at = excluded.updated_at
       WHERE excluded.source_ledger_index > current_state_overlay_objects.source_ledger_index
          OR (
            excluded.source_ledger_index = current_state_overlay_objects.source_ledger_index
            AND excluded.source_transaction_index > current_state_overlay_objects.source_transaction_index
          )`,
    )
    .bind(
      options.base.epochId,
      options.base.baseSnapshotId,
      options.mutation.objectType,
      options.mutation.objectId,
      options.mutation.operation,
      projection,
      links.owner ?? null,
      links.account ?? null,
      links.borrower ?? null,
      links.vaultId ?? null,
      links.loanBrokerId ?? null,
      links.assetKey ?? null,
      links.onLedgerStatus ?? null,
      options.ledgerIndex,
      options.ledgerHash,
      options.transactionHash,
      options.transactionIndex,
      options.updatedAt,
    )
}

export async function commitIncrementalScan(options: {
  db: D1Database
  epochId: string
  base: CurrentStateOverlayBaseIdentity
  expectedPreviousLedger: number
  expectedPreviousHash: string
  scan: IncrementalScanResult
  processedAt: string
  retainPayloads: boolean
}): Promise<IncrementalCommitStatus> {
  if (options.scan.ledgers.length === 0) return 'empty'
  assertScanChain(options)
  if (options.base.epochId !== options.epochId) {
    throw new Error('Incremental commit base epoch does not match the requested epoch')
  }

  const finalLedger = options.scan.ledgers.at(-1)
  if (!finalLedger) return 'empty'
  const cursor = await readCursor(options.db)
  if (!cursor || cursor.epoch_id !== options.epochId) {
    throw new Error('Incremental commit epoch does not match sync state')
  }
  const overlay = await assertCurrentStateOverlayBase({ db: options.db, base: options.base })

  if (
    cursor.last_processed_ledger === finalLedger.ledgerIndex &&
    cursor.last_processed_hash === finalLedger.ledgerHash &&
    overlay.overlayLedgerIndex === finalLedger.ledgerIndex &&
    overlay.overlayLedgerHash === finalLedger.ledgerHash
  ) {
    return 'already_committed'
  }
  if (
    cursor.last_processed_ledger !== options.expectedPreviousLedger ||
    cursor.last_processed_hash !== options.expectedPreviousHash
  ) {
    throw new Error('Incremental commit cursor changed before persistence')
  }
  if (
    overlay.overlayLedgerIndex !== options.expectedPreviousLedger ||
    overlay.overlayLedgerHash !== options.expectedPreviousHash
  ) {
    throw new Error('Current-state overlay watermark does not match the incremental cursor')
  }

  const token = commitToken({
    epochId: options.epochId,
    expectedPreviousLedger: options.expectedPreviousLedger,
    expectedPreviousHash: options.expectedPreviousHash,
    finalLedgerIndex: finalLedger.ledgerIndex,
    finalLedgerHash: finalLedger.ledgerHash,
  })
  const overlayBeforeToken = `${token}:overlay:before`
  const overlayAfterToken = `${token}:overlay:after`
  const statements: D1PreparedStatement[] = [
    options.db
      .prepare(
        `INSERT INTO incremental_commit_guards (
           commit_token, network, epoch_id, expected_ledger, expected_hash,
           observed_ledger, observed_hash, checked_at
         ) VALUES (
           ?1, 'devnet', ?2, ?3, ?4,
           (
             SELECT last_processed_ledger
             FROM sync_state
             WHERE network = 'devnet'
               AND epoch_id = ?2
           ),
           (
             SELECT last_processed_hash
             FROM sync_state
             WHERE network = 'devnet'
               AND epoch_id = ?2
           ),
           ?5
         )`,
      )
      .bind(
        token,
        options.epochId,
        options.expectedPreviousLedger,
        options.expectedPreviousHash,
        options.processedAt,
      ),
    overlayGuardStatement({
      db: options.db,
      token: overlayBeforeToken,
      base: options.base,
      expectedOverlayLedgerIndex: options.expectedPreviousLedger,
      expectedOverlayLedgerHash: options.expectedPreviousHash,
      checkedAt: options.processedAt,
    }),
  ]

  for (const ledger of options.scan.ledgers) {
    statements.push(
      options.db
        .prepare(
          `INSERT INTO processed_ledgers (
             network, epoch_id, ledger_index, ledger_hash, parent_hash,
             close_time, inspected_count, matched_count, endpoint, processed_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT(network, epoch_id, ledger_index) DO NOTHING`,
        )
        .bind(
          'devnet',
          options.epochId,
          ledger.ledgerIndex,
          ledger.ledgerHash,
          ledger.parentHash,
          ledger.closeTime,
          ledger.transactions.length,
          ledger.lendingTransactions.length,
          ledger.endpoint,
          options.processedAt,
        ),
    )

    for (const event of ledger.lendingTransactions) {
      const objectChanges = normalizeAffectedNodes(event.metadata, {
        network: 'devnet',
        epochId: options.epochId,
        ledgerIndex: ledger.ledgerIndex,
        closeTime: ledger.closeTime,
        transactionHash: event.hash,
        transactionIndex: event.transactionIndex,
        transactionType: event.transactionType,
        result: event.result,
      })
      const lifecycleEvents = deriveLoanLifecycleEvents(objectChanges)
      const archivedObjects = deriveArchivedObjects(objectChanges)
      const balanceHistory = deriveBalanceHistory(objectChanges)
      const overlayMutations = deriveCurrentStateOverlayMutations(event.metadata, {
        ledgerIndex: ledger.ledgerIndex,
        transactionHash: event.hash,
      })

      statements.push(
        options.db
          .prepare(
            `INSERT INTO protocol_events (
               network, epoch_id, event_hash, ledger_index, event_index,
               close_time, event_type, result_code, source_json, metadata_json,
               payload_retained, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(network, epoch_id, event_hash) DO NOTHING`,
          )
          .bind(
            'devnet',
            options.epochId,
            event.hash,
            ledger.ledgerIndex,
            event.transactionIndex,
            ledger.closeTime,
            event.transactionType,
            event.result,
            options.retainPayloads ? JSON.stringify(event.transaction) : null,
            options.retainPayloads ? JSON.stringify(event.metadata) : null,
            options.retainPayloads ? 1 : 0,
            options.processedAt,
          ),
      )

      for (const change of objectChanges) {
        statements.push(
          options.db
            .prepare(
              `INSERT INTO object_changes (
                 network, epoch_id, transaction_hash, ledger_index, transaction_index,
                 transaction_type, result_code, close_time, node_index, object_type,
                 object_id, action, field_name, before_json, after_json, value_type,
                 unsupported_field, vault_id, loan_broker_id, loan_id, account, owner,
                 borrower, asset_key, mpt_issuance_id, created_at
               ) VALUES (
                 ?1, ?2, ?3, ?4, ?5,
                 ?6, ?7, ?8, ?9, ?10,
                 ?11, ?12, ?13, ?14, ?15, ?16,
                 ?17, ?18, ?19, ?20, ?21, ?22,
                 ?23, ?24, ?25, ?26
               )
               ON CONFLICT(network, epoch_id, transaction_hash, node_index, object_id, field_name, action)
               DO NOTHING`,
            )
            .bind(
              change.network,
              change.epochId,
              change.transactionHash,
              change.ledgerIndex,
              change.transactionIndex,
              change.transactionType,
              change.result,
              change.closeTime,
              change.nodeIndex,
              change.objectType,
              change.objectId,
              change.action,
              change.fieldName,
              change.beforeJson,
              change.afterJson,
              change.valueType,
              change.unsupportedField ? 1 : 0,
              change.relationships.vaultId,
              change.relationships.loanBrokerId,
              change.relationships.loanId,
              change.relationships.account,
              change.relationships.owner,
              change.relationships.borrower,
              change.relationships.assetKey,
              change.relationships.mptIssuanceId,
              options.processedAt,
            ),
        )
      }

      for (const lifecycleEvent of lifecycleEvents) {
        statements.push(
          options.db
            .prepare(
              `INSERT INTO loan_lifecycle_events (
                 network, epoch_id, loan_id, transaction_hash, ledger_index,
                 transaction_index, close_time, event_type, transaction_type,
                 result_code, status_before, status_after, principal_before,
                 principal_after, total_value_before, total_value_after,
                 payment_remaining_before, payment_remaining_after, details_json,
                 created_at
               ) VALUES (
                 ?1, ?2, ?3, ?4, ?5,
                 ?6, ?7, ?8, ?9,
                 ?10, ?11, ?12, ?13,
                 ?14, ?15, ?16,
                 ?17, ?18, ?19,
                 ?20
               )
               ON CONFLICT(network, epoch_id, loan_id, transaction_hash, event_type)
               DO NOTHING`,
            )
            .bind(
              lifecycleEvent.network,
              lifecycleEvent.epochId,
              lifecycleEvent.loanId,
              lifecycleEvent.transactionHash,
              lifecycleEvent.ledgerIndex,
              lifecycleEvent.transactionIndex,
              lifecycleEvent.closeTime,
              lifecycleEvent.eventType,
              lifecycleEvent.transactionType,
              lifecycleEvent.result,
              lifecycleEvent.statusBefore,
              lifecycleEvent.statusAfter,
              lifecycleEvent.principalBefore,
              lifecycleEvent.principalAfter,
              lifecycleEvent.totalValueBefore,
              lifecycleEvent.totalValueAfter,
              lifecycleEvent.paymentRemainingBefore,
              lifecycleEvent.paymentRemainingAfter,
              lifecycleEvent.detailsJson,
              options.processedAt,
            ),
        )
      }

      for (const archivedObject of archivedObjects) {
        statements.push(
          options.db
            .prepare(
              `INSERT INTO archived_objects (
                 network, epoch_id, object_type, object_id, deletion_transaction_hash,
                 deletion_ledger_index, deletion_transaction_index, deletion_close_time,
                 deletion_reason, final_state_json, vault_id, loan_broker_id, loan_id,
                 owner, account, borrower, asset_key, archived_at
               ) VALUES (
                 ?1, ?2, ?3, ?4, ?5,
                 ?6, ?7, ?8,
                 ?9, ?10, ?11, ?12, ?13,
                 ?14, ?15, ?16, ?17, ?18
               )
               ON CONFLICT(network, epoch_id, object_type, object_id)
               DO NOTHING`,
            )
            .bind(
              archivedObject.network,
              archivedObject.epochId,
              archivedObject.objectType,
              archivedObject.objectId,
              archivedObject.deletionTransactionHash,
              archivedObject.deletionLedgerIndex,
              archivedObject.deletionTransactionIndex,
              archivedObject.deletionCloseTime,
              archivedObject.deletionReason,
              archivedObject.finalStateJson,
              archivedObject.vaultId,
              archivedObject.loanBrokerId,
              archivedObject.loanId,
              archivedObject.owner,
              archivedObject.account,
              archivedObject.borrower,
              archivedObject.assetKey,
              options.processedAt,
            ),
        )
      }

      for (const balanceRecord of balanceHistory) {
        statements.push(
          options.db
            .prepare(
              `INSERT INTO balance_history (
                 network, epoch_id, subject_type, subject_id, transaction_hash,
                 ledger_index, transaction_index, close_time, metric_type, asset_key,
                 before_value, after_value, formula, source_fields_json, created_at
               ) VALUES (
                 ?1, ?2, ?3, ?4, ?5,
                 ?6, ?7, ?8, ?9, ?10,
                 ?11, ?12, ?13, ?14, ?15
               )
               ON CONFLICT(network, epoch_id, subject_type, subject_id, transaction_hash, metric_type)
               DO NOTHING`,
            )
            .bind(
              balanceRecord.network,
              balanceRecord.epochId,
              balanceRecord.subjectType,
              balanceRecord.subjectId,
              balanceRecord.transactionHash,
              balanceRecord.ledgerIndex,
              balanceRecord.transactionIndex,
              balanceRecord.closeTime,
              balanceRecord.metricType,
              balanceRecord.assetKey,
              balanceRecord.beforeValue,
              balanceRecord.afterValue,
              balanceRecord.formula,
              balanceRecord.sourceFieldsJson,
              options.processedAt,
            ),
        )
      }

      for (const mutation of overlayMutations) {
        statements.push(
          overlayMutationStatement({
            db: options.db,
            base: options.base,
            mutation,
            ledgerIndex: ledger.ledgerIndex,
            ledgerHash: ledger.ledgerHash,
            transactionHash: event.hash,
            transactionIndex: event.transactionIndex,
            updatedAt: options.processedAt,
          }),
        )
      }
    }
  }

  statements.push(
    options.db
      .prepare(
        `UPDATE current_state_overlay_state
         SET overlay_ledger_index = ?1,
             overlay_ledger_hash = ?2,
             updated_at = ?3
         WHERE network = 'devnet'
           AND epoch_id = ?4
           AND base_snapshot_id = ?5
           AND base_ledger_index = ?6
           AND base_ledger_hash = ?7
           AND overlay_ledger_index = ?8
           AND overlay_ledger_hash = ?9`,
      )
      .bind(
        finalLedger.ledgerIndex,
        finalLedger.ledgerHash,
        options.processedAt,
        options.base.epochId,
        options.base.baseSnapshotId,
        options.base.baseLedgerIndex,
        options.base.baseLedgerHash,
        options.expectedPreviousLedger,
        options.expectedPreviousHash,
      ),
  )

  statements.push(
    overlayGuardStatement({
      db: options.db,
      token: overlayAfterToken,
      base: options.base,
      expectedOverlayLedgerIndex: finalLedger.ledgerIndex,
      expectedOverlayLedgerHash: finalLedger.ledgerHash,
      checkedAt: options.processedAt,
    }),
  )

  statements.push(
    options.db
      .prepare(
        `UPDATE sync_state
         SET last_processed_ledger = ?1,
             last_processed_hash = ?2,
             last_success_at = ?3,
             status = 'healthy',
             consecutive_failures = 0,
             endpoint = ?4,
             error_code = NULL,
             error_message = NULL,
             updated_at = ?3
         WHERE network = 'devnet'
           AND epoch_id = ?5
           AND last_processed_ledger = ?6
           AND last_processed_hash = ?7`,
      )
      .bind(
        finalLedger.ledgerIndex,
        finalLedger.ledgerHash,
        options.processedAt,
        options.scan.endpoint,
        options.epochId,
        options.expectedPreviousLedger,
        options.expectedPreviousHash,
      ),
  )

  statements.push(
    options.db
      .prepare(
        `DELETE FROM current_state_overlay_commit_guards
         WHERE commit_token IN (?1, ?2)`,
      )
      .bind(overlayBeforeToken, overlayAfterToken),
  )

  statements.push(
    options.db
      .prepare('DELETE FROM incremental_commit_guards WHERE commit_token = ?1')
      .bind(token),
  )

  await options.db.batch(statements)
  const committed = await readCursor(options.db)
  if (
    committed?.epoch_id !== options.epochId ||
    committed.last_processed_ledger !== finalLedger.ledgerIndex ||
    committed.last_processed_hash !== finalLedger.ledgerHash
  ) {
    throw new Error('Incremental commit did not advance the cursor to the final ledger')
  }
  const committedOverlay = await assertCurrentStateOverlayBase({ db: options.db, base: options.base })
  if (
    committedOverlay.overlayLedgerIndex !== finalLedger.ledgerIndex ||
    committedOverlay.overlayLedgerHash !== finalLedger.ledgerHash
  ) {
    throw new Error('Incremental commit did not advance the overlay watermark to the final ledger')
  }
  return 'committed'
}
