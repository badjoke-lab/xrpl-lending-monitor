import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'

interface CursorRow {
  epoch_id: string | null
  last_processed_ledger: number | null
  last_processed_hash: string | null
}

export type IncrementalCommitStatus = 'empty' | 'committed' | 'already_committed'

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

  const statements: D1PreparedStatement[] = []
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
