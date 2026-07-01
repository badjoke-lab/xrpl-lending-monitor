import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import { commitIncrementalScan } from './incremental-ledger-repository'

interface CursorRow {
  epoch_id: string
  last_processed_ledger: number
  last_processed_hash: string
}

interface StatementRecord {
  sql: string
  values: unknown[]
}

interface StoredLedger {
  network: string
  epochId: string
  ledgerIndex: number
  ledgerHash: string
}

interface StoredEvent {
  network: string
  epochId: string
  eventHash: string
  ledgerIndex: number
  eventIndex: number
  sourceJson: string | null
  metadataJson: string | null
  payloadRetained: number
}

interface StoredObjectChange {
  network: string
  epochId: string
  transactionHash: string
  nodeIndex: number
  objectId: string
  action: string
  fieldName: string
  beforeJson: string | null
  afterJson: string | null
  unsupportedField: number
}

interface DatabaseState {
  cursor: CursorRow | null
  processedLedgers: StoredLedger[]
  protocolEvents: StoredEvent[]
  objectChanges: StoredObjectChange[]
  guards: string[]
}

function cloneState(state: DatabaseState): DatabaseState {
  return {
    cursor: state.cursor ? { ...state.cursor } : null,
    processedLedgers: state.processedLedgers.map((item) => ({ ...item })),
    protocolEvents: state.protocolEvents.map((item) => ({ ...item })),
    objectChanges: state.objectChanges.map((item) => ({ ...item })),
    guards: [...state.guards],
  }
}

function fakeDatabase(options: {
  cursor: CursorRow | null
  cursorAtBatch?: CursorRow | null
  failOnProtocolEvent?: boolean
  processedLedgers?: StoredLedger[]
  protocolEvents?: StoredEvent[]
  objectChanges?: StoredObjectChange[]
}) {
  const statements: StatementRecord[] = []
  const batches: number[][] = []
  const state: DatabaseState = {
    cursor: options.cursor,
    processedLedgers: options.processedLedgers ?? [],
    protocolEvents: options.protocolEvents ?? [],
    objectChanges: options.objectChanges ?? [],
    guards: [],
  }
  const db = {
    prepare(sql: string) {
      const index = statements.length
      const record: StatementRecord = { sql, values: [] }
      statements.push(record)
      const statement = {
        __index: index,
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async first<T>() {
          return (state.cursor ? { ...state.cursor } : null) as T | null
        },
      }
      return statement
    },
    async batch(items: Array<{ __index?: number }>) {
      if (options.cursorAtBatch !== undefined) state.cursor = options.cursorAtBatch
      const draft = cloneState(state)
      for (const item of items) {
        const record = statements[item.__index ?? -1]
        if (!record) throw new Error('Unknown statement')
        applyStatement(draft, record, options)
      }
      state.cursor = draft.cursor
      state.processedLedgers = draft.processedLedgers
      state.protocolEvents = draft.protocolEvents
      state.objectChanges = draft.objectChanges
      state.guards = draft.guards
      batches.push(items.map((item) => item.__index ?? -1))
      return []
    },
  }
  return { db: db as unknown as D1Database, statements, batches, state }
}

function applyStatement(
  state: DatabaseState,
  statement: StatementRecord,
  options: { failOnProtocolEvent?: boolean },
): void {
  if (statement.sql.includes('incremental_commit_guards') && statement.sql.includes('INSERT')) {
    const [token, epochId, expectedLedger, expectedHash] = statement.values
    if (
      typeof token !== 'string' ||
      typeof epochId !== 'string' ||
      typeof expectedLedger !== 'number' ||
      typeof expectedHash !== 'string'
    ) {
      throw new Error('Invalid guard bind values')
    }
    if (
      !state.cursor ||
      state.cursor.epoch_id !== epochId ||
      state.cursor.last_processed_ledger !== expectedLedger ||
      state.cursor.last_processed_hash !== expectedHash
    ) {
      throw new Error('CHECK constraint failed: incremental_commit_guards')
    }
    state.guards.push(token)
    return
  }

  if (statement.sql.includes('INSERT INTO processed_ledgers')) {
    const [network, epochId, ledgerIndex, ledgerHash] = statement.values
    if (
      typeof network !== 'string' ||
      typeof epochId !== 'string' ||
      typeof ledgerIndex !== 'number' ||
      typeof ledgerHash !== 'string'
    ) {
      throw new Error('Invalid processed ledger bind values')
    }
    if (
      !state.processedLedgers.some(
        (item) =>
          item.network === network && item.epochId === epochId && item.ledgerIndex === ledgerIndex,
      )
    ) {
      state.processedLedgers.push({ network, epochId, ledgerIndex, ledgerHash })
    }
    return
  }

  if (statement.sql.includes('INSERT INTO protocol_events')) {
    if (options.failOnProtocolEvent) throw new Error('protocol event constraint failure')
    const [
      network,
      epochId,
      eventHash,
      ledgerIndex,
      eventIndex,
      ,
      ,
      ,
      sourceJson,
      metadataJson,
      payloadRetained,
    ] = statement.values
    if (
      typeof network !== 'string' ||
      typeof epochId !== 'string' ||
      typeof eventHash !== 'string' ||
      typeof ledgerIndex !== 'number' ||
      typeof eventIndex !== 'number' ||
      typeof payloadRetained !== 'number'
    ) {
      throw new Error('Invalid protocol event bind values')
    }
    if (
      !state.protocolEvents.some(
        (item) => item.network === network && item.epochId === epochId && item.eventHash === eventHash,
      )
    ) {
      state.protocolEvents.push({
        network,
        epochId,
        eventHash,
        ledgerIndex,
        eventIndex,
        sourceJson: typeof sourceJson === 'string' ? sourceJson : null,
        metadataJson: typeof metadataJson === 'string' ? metadataJson : null,
        payloadRetained,
      })
    }
    return
  }

  if (statement.sql.includes('INSERT INTO object_changes')) {
    const [
      network,
      epochId,
      transactionHash,
      ,
      ,
      ,
      ,
      ,
      nodeIndex,
      ,
      objectId,
      action,
      fieldName,
      beforeJson,
      afterJson,
      ,
      unsupportedField,
    ] = statement.values
    if (
      typeof network !== 'string' ||
      typeof epochId !== 'string' ||
      typeof transactionHash !== 'string' ||
      typeof nodeIndex !== 'number' ||
      typeof objectId !== 'string' ||
      typeof action !== 'string' ||
      typeof fieldName !== 'string' ||
      typeof unsupportedField !== 'number'
    ) {
      throw new Error('Invalid object change bind values')
    }
    if (
      !state.objectChanges.some(
        (item) =>
          item.network === network &&
          item.epochId === epochId &&
          item.transactionHash === transactionHash &&
          item.nodeIndex === nodeIndex &&
          item.objectId === objectId &&
          item.fieldName === fieldName &&
          item.action === action,
      )
    ) {
      state.objectChanges.push({
        network,
        epochId,
        transactionHash,
        nodeIndex,
        objectId,
        action,
        fieldName,
        beforeJson: typeof beforeJson === 'string' ? beforeJson : null,
        afterJson: typeof afterJson === 'string' ? afterJson : null,
        unsupportedField,
      })
    }
    return
  }

  if (statement.sql.includes('UPDATE sync_state')) {
    const [ledgerIndex, ledgerHash, , , epochId, expectedLedger, expectedHash] = statement.values
    if (
      typeof ledgerIndex !== 'number' ||
      typeof ledgerHash !== 'string' ||
      typeof epochId !== 'string' ||
      typeof expectedLedger !== 'number' ||
      typeof expectedHash !== 'string'
    ) {
      throw new Error('Invalid sync state bind values')
    }
    if (
      state.cursor?.epoch_id === epochId &&
      state.cursor.last_processed_ledger === expectedLedger &&
      state.cursor.last_processed_hash === expectedHash
    ) {
      state.cursor = {
        epoch_id: epochId,
        last_processed_ledger: ledgerIndex,
        last_processed_hash: ledgerHash,
      }
    }
    return
  }

  if (statement.sql.includes('incremental_commit_guards') && statement.sql.includes('DELETE')) {
    const [token] = statement.values
    state.guards = state.guards.filter((item) => item !== token)
    return
  }

  throw new Error(`Unhandled statement: ${statement.sql}`)
}

function scan(): IncrementalScanResult {
  const transaction = {
    hash: 'T'.repeat(64),
    transactionType: 'LoanPay',
    account: 'rAccount',
    sequence: 7,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex: 1,
    transaction: { TransactionType: 'LoanPay', Amount: '100' },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: 1,
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: 'Loan',
            LedgerIndex: 'L'.repeat(64),
            PreviousFields: {
              PaymentRemaining: 2,
              FutureProtocolField: 'before',
            },
            FinalFields: {
              LoanBrokerID: 'B'.repeat(64),
              PaymentRemaining: 1,
              FutureProtocolField: 'after',
            },
          },
        },
      ],
    },
  }
  return {
    endpoint: 'https://devnet.example',
    startLedgerIndex: 11,
    endLedgerIndex: 12,
    latestValidatedLedger: 12,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://devnet.example',
        ledgerIndex: 11,
        ledgerHash: 'B'.repeat(64),
        parentHash: 'A'.repeat(64),
        closeTime: 1001,
        transactions: [transaction],
        lendingTransactions: [transaction],
      },
      {
        endpoint: 'https://devnet.example',
        ledgerIndex: 12,
        ledgerHash: 'C'.repeat(64),
        parentHash: 'B'.repeat(64),
        closeTime: 1002,
        transactions: [],
        lendingTransactions: [],
      },
    ],
    metrics: {
      ledgers: 2,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 20,
    },
  }
}

const before = {
  epoch_id: 'epoch-1',
  last_processed_ledger: 10,
  last_processed_hash: 'A'.repeat(64),
}
const after = {
  epoch_id: 'epoch-1',
  last_processed_ledger: 12,
  last_processed_hash: 'C'.repeat(64),
}

async function commitWith(
  state: ReturnType<typeof fakeDatabase>,
  options: { retainPayloads?: boolean; scan?: IncrementalScanResult } = {},
) {
  return commitIncrementalScan({
    db: state.db,
    epochId: 'epoch-1',
    expectedPreviousLedger: 10,
    expectedPreviousHash: 'A'.repeat(64),
    scan: options.scan ?? scan(),
    processedAt: '2026-07-01T00:00:00.000Z',
    retainPayloads: options.retainPayloads ?? true,
  })
}

describe('commitIncrementalScan', () => {
  it('checks the expected cursor inside the batch before writing ledgers and events', async () => {
    const state = fakeDatabase({ cursor: before })
    await expect(commitWith(state)).resolves.toBe('committed')

    expect(state.batches).toHaveLength(1)
    const batched = state.batches[0]?.map((index) => state.statements[index]?.sql) ?? []
    expect(batched.at(0)).toContain('INSERT INTO incremental_commit_guards')
    expect(batched.filter((sql) => sql?.includes('INSERT INTO processed_ledgers'))).toHaveLength(2)
    expect(batched.filter((sql) => sql?.includes('INSERT INTO protocol_events'))).toHaveLength(1)
    expect(batched.filter((sql) => sql?.includes('INSERT INTO object_changes'))).toHaveLength(2)
    expect(batched.at(-2)).toContain('UPDATE sync_state')
    expect(batched.at(-1)).toContain('DELETE FROM incremental_commit_guards')
    expect(state.state.cursor).toEqual(after)
    expect(state.state.processedLedgers.map((item) => item.ledgerIndex)).toEqual([11, 12])
    expect(state.state.protocolEvents).toHaveLength(1)
    expect(state.state.protocolEvents[0]?.sourceJson).toBe(
      JSON.stringify({ TransactionType: 'LoanPay', Amount: '100' }),
    )
    expect(state.state.protocolEvents[0]?.payloadRetained).toBe(1)
    expect(state.state.objectChanges.map((item) => [item.fieldName, item.beforeJson, item.afterJson])).toEqual([
      ['FutureProtocolField', '"before"', '"after"'],
      ['PaymentRemaining', '2', '1'],
    ])
    expect(state.state.objectChanges[0]?.unsupportedField).toBe(1)
    expect(state.state.guards).toEqual([])
  })

  it('stores no source payload when retention is disabled', async () => {
    const state = fakeDatabase({ cursor: before })
    await commitWith(state, { retainPayloads: false })

    expect(state.state.protocolEvents[0]).toMatchObject({
      sourceJson: null,
      metadataJson: null,
      payloadRetained: 0,
    })
  })

  it('returns already committed after an ambiguous retry reaches the same final cursor', async () => {
    const state = fakeDatabase({ cursor: after })

    await expect(commitWith(state)).resolves.toBe('already_committed')
    expect(state.batches).toHaveLength(0)
    expect(state.state.processedLedgers).toHaveLength(0)
    expect(state.state.protocolEvents).toHaveLength(0)
    expect(state.state.objectChanges).toHaveLength(0)
  })

  it('rolls back processed ledgers and protocol events when the cursor changes inside the batch', async () => {
    const state = fakeDatabase({
      cursor: before,
      cursorAtBatch: {
        epoch_id: 'epoch-1',
        last_processed_ledger: 11,
        last_processed_hash: 'B'.repeat(64),
      },
    })

    await expect(commitWith(state)).rejects.toThrow('CHECK constraint failed')
    expect(state.state.cursor?.last_processed_ledger).toBe(11)
    expect(state.state.processedLedgers).toHaveLength(0)
    expect(state.state.protocolEvents).toHaveLength(0)
    expect(state.state.objectChanges).toHaveLength(0)
    expect(state.state.guards).toEqual([])
  })

  it('rolls back processed ledgers when a mid-batch protocol event write fails', async () => {
    const state = fakeDatabase({ cursor: before, failOnProtocolEvent: true })

    await expect(commitWith(state)).rejects.toThrow('protocol event constraint failure')
    expect(state.state.cursor).toEqual(before)
    expect(state.state.processedLedgers).toHaveLength(0)
    expect(state.state.protocolEvents).toHaveLength(0)
    expect(state.state.objectChanges).toHaveLength(0)
    expect(state.state.guards).toEqual([])
  })

  it('reprocessing the same range does not duplicate canonical events or object changes', async () => {
    const existingEvent = {
      network: 'devnet',
      epochId: 'epoch-1',
      eventHash: 'T'.repeat(64),
      ledgerIndex: 11,
      eventIndex: 1,
      sourceJson: '{}',
      metadataJson: '{}',
      payloadRetained: 1,
    }
    const existingChange = {
      network: 'devnet',
      epochId: 'epoch-1',
      transactionHash: 'T'.repeat(64),
      nodeIndex: 0,
      objectId: 'L'.repeat(64),
      action: 'modified',
      fieldName: 'PaymentRemaining',
      beforeJson: '2',
      afterJson: '1',
      unsupportedField: 0,
    }
    const state = fakeDatabase({
      cursor: before,
      processedLedgers: [
        { network: 'devnet', epochId: 'epoch-1', ledgerIndex: 11, ledgerHash: 'B'.repeat(64) },
        { network: 'devnet', epochId: 'epoch-1', ledgerIndex: 12, ledgerHash: 'C'.repeat(64) },
      ],
      protocolEvents: [existingEvent],
      objectChanges: [existingChange],
    })

    await expect(commitWith(state)).resolves.toBe('committed')
    expect(state.state.processedLedgers).toHaveLength(2)
    expect(state.state.protocolEvents).toEqual([existingEvent])
    expect(state.state.objectChanges).toHaveLength(2)
    expect(
      state.state.objectChanges.filter((item) => item.fieldName === 'PaymentRemaining'),
    ).toHaveLength(1)
  })

  it('rejects persistence when the cursor changed before the batch', async () => {
    const state = fakeDatabase({
      cursor: {
        epoch_id: 'epoch-1',
        last_processed_ledger: 11,
        last_processed_hash: 'B'.repeat(64),
      },
    })

    await expect(commitWith(state)).rejects.toThrow('cursor changed before persistence')
    expect(state.batches).toHaveLength(0)
    expect(state.state.processedLedgers).toHaveLength(0)
    expect(state.state.protocolEvents).toHaveLength(0)
    expect(state.state.objectChanges).toHaveLength(0)
  })

  it('rejects ledger index gaps before persistence', async () => {
    const state = fakeDatabase({ cursor: before })
    const withGap = {
      ...scan(),
      ledgers: scan().ledgers.map((ledger, index) =>
        index === 1 ? { ...ledger, ledgerIndex: 13 } : ledger,
      ),
    }

    await expect(commitWith(state, { scan: withGap })).rejects.toThrow('ledger index gap')
    expect(state.batches).toHaveLength(0)
  })

  it('rejects ledger parent-hash discontinuities before persistence', async () => {
    const state = fakeDatabase({ cursor: before })
    const withDiscontinuity = {
      ...scan(),
      ledgers: scan().ledgers.map((ledger, index) =>
        index === 1 ? { ...ledger, parentHash: 'D'.repeat(64) } : ledger,
      ),
    }

    await expect(commitWith(state, { scan: withDiscontinuity })).rejects.toThrow(
      'ledger hash discontinuity',
    )
    expect(state.batches).toHaveLength(0)
  })

  it('does not query or write for an empty scan', async () => {
    const state = fakeDatabase({ cursor: null })
    const empty = { ...scan(), ledgers: [], endLedgerIndex: null }

    await expect(commitWith(state, { scan: empty })).resolves.toBe('empty')
    expect(state.statements).toHaveLength(0)
  })
})
