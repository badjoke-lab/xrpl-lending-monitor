import { describe, expect, it } from 'vitest'

import type { Bindings } from './env'
import { app } from './index'

interface FakeStatement {
  bind: (...values: unknown[]) => FakeStatement
  first: <T>() => Promise<T | null>
  all: <T>() => Promise<{ results: T[] }>
}

function protocolEventRow(includePayload: boolean) {
  return {
    event_hash: 'TX1',
    epoch_id: 'epoch-1',
    ledger_index: 200,
    event_index: 1,
    close_time: 800_000_000,
    event_type: 'LoanSet',
    result_code: 'tesSUCCESS',
    payload_retained: includePayload ? 1 : 0,
    source_json: includePayload ? '{"TransactionType":"LoanSet"}' : null,
    metadata_json: includePayload ? '{"TransactionResult":"tesSUCCESS"}' : null,
    created_at: '2026-07-01T00:00:00.000Z',
  }
}

function objectChangeRow() {
  return {
    transaction_hash: 'TX1',
    epoch_id: 'epoch-1',
    ledger_index: 200,
    transaction_index: 1,
    transaction_type: 'LoanSet',
    result_code: 'tesSUCCESS',
    close_time: 800_000_000,
    node_index: 0,
    object_type: 'Loan',
    object_id: 'LOAN1',
    action: 'modified',
    field_name: 'PrincipalOutstanding',
    before_json: '"100"',
    after_json: '"90"',
    value_type: 'string',
    unsupported_field: 0,
    vault_id: 'VAULT1',
    loan_broker_id: 'BROKER1',
    loan_id: 'LOAN1',
    account: null,
    owner: null,
    borrower: 'rBorrower',
    asset_key: 'XRP',
    mpt_issuance_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
  }
}

function createFakeDatabase(): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = []
      const statement: FakeStatement = {
        bind(...values: unknown[]) {
          bindings = values
          return statement
        },
        async first<T>() {
          if (sql.includes('FROM protocol_events') && sql.includes('event_hash = ?1')) {
            return (bindings[0] === 'TX1' ? protocolEventRow(true) : null) as T | null
          }

          return null
        },
        async all<T>() {
          if (sql.includes('UNION ALL')) {
            return {
              results: [
                {
                  kind: 'transaction',
                  epoch_id: 'epoch-1',
                  ledger_index: 200,
                  transaction_hash: 'TX1',
                  object_type: null,
                  object_id: null,
                  loan_id: null,
                },
              ] as T[],
            }
          }

          if (sql.includes('FROM protocol_events')) {
            return { results: [protocolEventRow(false)] as T[] }
          }

          if (sql.includes('FROM object_changes')) {
            return { results: [objectChangeRow()] as T[] }
          }

          if (sql.includes('FROM loan_lifecycle_events')) {
            return {
              results: [
                {
                  loan_id: 'LOAN1',
                  epoch_id: 'epoch-1',
                  transaction_hash: 'TX1',
                  ledger_index: 200,
                  transaction_index: 1,
                  close_time: 800_000_000,
                  event_type: 'payment',
                  transaction_type: 'LoanPay',
                  result_code: 'tesSUCCESS',
                  status_before: 'active',
                  status_after: 'active',
                  principal_before: '100',
                  principal_after: '90',
                  total_value_before: '110',
                  total_value_after: '99',
                  payment_remaining_before: 10,
                  payment_remaining_after: 9,
                  details_json: '{"payment":"10"}',
                  created_at: '2026-07-01T00:00:00.000Z',
                },
              ] as T[],
            }
          }

          if (sql.includes('FROM network_epochs')) {
            return {
              results: [
                {
                  id: 'epoch-1',
                  status: 'current',
                  first_ledger_index: 100,
                  first_ledger_hash: 'FIRST',
                  last_ledger_index: null,
                  last_ledger_hash: null,
                  started_at: '2026-07-01T00:00:00.000Z',
                  ended_at: null,
                  reset_reason: null,
                },
              ] as T[],
            }
          }

          return { results: [] as T[] }
        },
      }

      return statement
    },
  } as unknown as D1Database
}

function createEnv(db: D1Database): Bindings {
  return {
    APP_NETWORK: 'devnet',
    MAINNET_ENABLED: 'false',
    XRPL_DEVNET_RPC_URL: 'https://s.devnet.rippletest.net:51234/',
    DB: db,
    ASSETS: {
      fetch: () => Promise.resolve(new Response('not found', { status: 404 })),
    } as Fetcher,
  }
}

describe('history API routes', () => {
  it('lists bounded activity without raw payloads', async () => {
    const response = await app.request('/api/activity?limit=1', {}, createEnv(createFakeDatabase()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      data: [
        {
          transaction_hash: 'TX1',
          transaction_type: 'LoanSet',
          source_json: null,
          metadata_json: null,
          provenance: 'indexed',
        },
      ],
      page: { limit: 1, next_cursor: null },
    })
  })

  it('returns transaction detail with retained payloads and object changes', async () => {
    const response = await app.request('/api/transactions/TX1', {}, createEnv(createFakeDatabase()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      transaction_hash: 'TX1',
      found: true,
      event: {
        transaction_hash: 'TX1',
        source_json: { TransactionType: 'LoanSet' },
        metadata_json: { TransactionResult: 'tesSUCCESS' },
      },
      object_changes: [
        {
          object_type: 'Loan',
          object_id: 'LOAN1',
          before_json: '100',
          after_json: '90',
        },
      ],
    })
  })

  it('lists loan lifecycle events in indexed order', async () => {
    const response = await app.request('/api/loans/LOAN1/lifecycle?limit=5', {}, createEnv(createFakeDatabase()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      loan_id: 'LOAN1',
      data: [
        {
          event_type: 'payment',
          principal_before: '100',
          principal_after: '90',
          details_json: { payment: '10' },
        },
      ],
      page: { limit: 5, next_cursor: null },
    })
  })

  it('requires a bounded search query', async () => {
    const missingQuery = await app.request('/api/search', {}, createEnv(createFakeDatabase()))
    expect(missingQuery.status).toBe(400)

    const invalidLimit = await app.request('/api/search?q=TX1&limit=0', {}, createEnv(createFakeDatabase()))
    expect(invalidLimit.status).toBe(400)
  })

  it('searches exact indexed identifiers', async () => {
    const response = await app.request('/api/search?q=TX1&limit=10', {}, createEnv(createFakeDatabase()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      query: 'TX1',
      data: [
        {
          kind: 'transaction',
          transaction_hash: 'TX1',
          provenance: 'indexed',
        },
      ],
      page: { limit: 10, next_cursor: null },
    })
  })

  it('lists Devnet epochs', async () => {
    const response = await app.request('/api/epochs', {}, createEnv(createFakeDatabase()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: 'devnet',
      data: [
        {
          id: 'epoch-1',
          network: 'devnet',
          status: 'current',
          first_ledger_index: 100,
          provenance: 'direct',
        },
      ],
    })
  })
})
