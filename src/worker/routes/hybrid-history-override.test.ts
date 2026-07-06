import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings } from '../env'
import { resolveHistorySource } from '../repositories/history-source'
import { handleHybridHistoryOverride } from './hybrid-history-override'

vi.mock('../repositories/history-source', () => ({
  resolveHistorySource: vi.fn(),
}))

const mockedResolve = vi.mocked(resolveHistorySource)

interface FakeStatement {
  bind: (...values: unknown[]) => FakeStatement
  all: <T>() => Promise<{ results: T[] }>
}

function db(): D1Database {
  return {
    prepare(sql: string) {
      const statement: FakeStatement = {
        bind() { return statement },
        async all<T>() {
          if (sql.includes('FROM protocol_events')) {
            return { results: [{
              event_hash: 'LIVE-106',
              epoch_id: 'epoch-1',
              ledger_index: 106,
              event_index: 1,
              close_time: 800_000_001,
              event_type: 'LoanPay',
              result_code: 'tesSUCCESS',
              payload_retained: 0,
              created_at: '2025-05-08T06:13:21.000Z',
            }] as T[] }
          }
          return { results: [] as T[] }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

function env(): Bindings {
  return {
    APP_NETWORK: 'devnet',
    MAINNET_ENABLED: 'false',
    XRPL_DEVNET_RPC_URL: 'https://devnet.example/',
    DB: db(),
    ASSETS: { fetch: () => Promise.resolve(new Response('not found', { status: 404 })) } as Fetcher,
  }
}

function hybridSource() {
  const reader = {
    publication: {
      epochId: 'epoch-1',
      endLedgerIndex: 105,
    },
    async list() {
      return {
        items: [{
          eventHash: 'IMMUTABLE-105',
          ledgerIndex: 105,
          eventIndex: 1,
          closeTime: 800_000_000,
          eventType: 'LoanPay',
          resultCode: 'tesSUCCESS',
          account: 'rAccount',
          sequence: 1,
          fee: '10',
        }],
        nextCursor: null,
        complete: true,
        segmentReads: 1,
        compressedBytes: 100,
        decompressedBytes: 200,
        recordsExamined: 1,
      }
    },
  }
  return {
    kind: 'hybrid' as const,
    configured: true as const,
    reader,
    channel: {
      schemaVersion: 1 as const,
      active: {
        dataCommitSha: 'b'.repeat(40),
        publicationPath: 'history/publication.json',
        publicationSha256: 'a'.repeat(64),
        chainId: 'chain-1',
        epochId: 'epoch-1',
      },
      updatedAt: '2026-07-06T00:00:00.000Z',
    },
    publication: {
      chainId: 'chain-1',
      epochId: 'epoch-1',
      startLedgerIndex: 101,
      endLedgerIndex: 105,
      segmentCount: 1,
      ledgerCount: 5,
      publicationSha256: 'a'.repeat(64),
    },
    unavailableReason: null,
  }
}

beforeEach(() => {
  mockedResolve.mockReset()
})

describe('hybrid history route override', () => {
  it('passes through to existing D1 routes when history is not configured', async () => {
    mockedResolve.mockResolvedValue({
      kind: 'd1', configured: false, reader: null, channel: null, publication: null, unavailableReason: null,
    })
    await expect(handleHybridHistoryOverride(
      new Request('https://example.test/api/activity'),
      env(),
    )).resolves.toBeNull()
  })

  it('returns explicit unavailable instead of silent D1 fallback for invalid configured history', async () => {
    mockedResolve.mockResolvedValue({
      kind: 'unavailable', configured: true, reader: null, channel: null, publication: null,
      unavailableReason: 'history_source_integrity_error',
    })
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/activity'),
      env(),
    )
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      error: 'history_source_unavailable',
      reason: 'history_source_integrity_error',
    })
  })

  it('serves merged newest-first activity through the existing response shape', async () => {
    mockedResolve.mockResolvedValue(hybridSource() as never)
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/activity?limit=10'),
      env(),
    )
    expect(response?.status).toBe(200)
    const body = await response?.json() as { data: { transaction_hash: string }[]; page: unknown }
    expect(body.data.map((item) => item.transaction_hash)).toEqual(['LIVE-106', 'IMMUTABLE-105'])
    expect(body.page).toEqual({ limit: 10, next_cursor: null })
  })

  it('fails explicitly for exact history lookup until immutable indexes exist', async () => {
    mockedResolve.mockResolvedValue(hybridSource() as never)
    const response = await handleHybridHistoryOverride(
      new Request('https://example.test/api/transactions/TX1'),
      env(),
    )
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      error: 'history_exact_lookup_unavailable',
    })
  })
})
