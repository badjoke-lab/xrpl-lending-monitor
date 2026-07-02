import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import { normalizeAffectedNodes } from '../../collector/incremental/affected-nodes'
import { deriveLoanLifecycleEvents } from '../../collector/incremental/loan-lifecycle'

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

export async function commitIncrementalScan(options: {
  db: D1Database
  epochId: string
  expectedPreviousLedger: number
  expectedPreviousHash: string
  scan: IncrementalScanResult
  processedAt: string
  retainPayloads: boolean
}): Promise<IncrementalCommitStatus> {
  if (options.scan.ledgers.length === 0) return 'empty'
  assertScanChain(options)

  const finalLedger = options.scan.ledgers.at(-1)
  if (!finalLedger) return 'empty'
  const cursor = await readCursor(options.db)
  if (!cursor || cursor.epoch_id !== options.epochId) {
    throw new Error('Incremental commit epoch does not match sync state')
  }
  if (
    cursor.last_processed_ledger === finalLedger.ledgerIndex &&
    cursor.last_processed_hash === finalLedger.ledgerHash
  ) {
    return 'already_committed'
  }
  if (
    cursor.last_processed_ledger !== options.expectedPreviousLedger ||
    cursor.last_processed_hash !== options.expectedPreviousHash
  ) {
    throw new Error('Incremental commit cursor changed before persistence')
  }

  const token = commitToken({
    epochId: options.epochId,
    expectedPreviousLedger: options.expectedPreviousLedger,
    expectedPreviousHash: options.expectedPreviousHash,
    finalLedgerIndex: finalLedger.ledgerIndex,
    finalLedgerHash: finalLedger.ledgerHash,
  })
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
    }
  }

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
  return 'committed'
}
