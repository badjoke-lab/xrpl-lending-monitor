import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bindings } from '../env'
import { searchGithubCurrentStateExact } from '../repositories/github-current-indexes'
import { getHybridTransactionDetail, searchHybridHistory } from '../repositories/hybrid-exact-history-repository'
import { resolveHistorySource } from '../repositories/history-source'
import { resolveCurrentStateStorage } from '../repositories/release-current-state'
import { handleHybridExactHistoryOverride } from './hybrid-exact-history-override'

vi.mock('../repositories/history-source', () => ({ resolveHistorySource: vi.fn() }))
vi.mock('../repositories/hybrid-exact-history-repository', () => ({
  getHybridTransactionDetail: vi.fn(),
  searchHybridHistory: vi.fn(),
}))
vi.mock('../repositories/release-current-state', () => ({
  resolveCurrentStateStorage: vi.fn(),
  isReleaseCurrentStateSource: vi.fn(() => false),
}))
vi.mock('../repositories/github-current-indexes', () => ({ searchGithubCurrentStateExact: vi.fn() }))

const source = vi.mocked(resolveHistorySource)
const transaction = vi.mocked(getHybridTransactionDetail)
const search = vi.mocked(searchHybridHistory)
const currentState = vi.mocked(resolveCurrentStateStorage)
const currentSearch = vi.mocked(searchGithubCurrentStateExact)

function env(): Bindings {
  return {
    APP_NETWORK: 'devnet', MAINNET_ENABLED: 'false', XRPL_DEVNET_RPC_URL: 'https://devnet.example/',
    DB: {} as D1Database,
    ASSETS: { fetch: () => Promise.resolve(new Response('missing', { status: 404 })) } as Fetcher,
  }
}

function hybrid(exact = true) {
  return {
    kind: 'hybrid', configured: true,
    reader: { publication: { endLedgerIndex: 105 } },
    exactIndex: exact ? { reader: {}, manifest: {} } : null,
    channel: {}, publication: {}, unavailableReason: null,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  currentState.mockResolvedValue({ snapshot: null, source: null } as never)
})

describe('hybrid exact history override', () => {
  it('passes through when immutable history is not configured', async () => {
    source.mockResolvedValue({
      kind: 'd1', configured: false, reader: null, exactIndex: null,
      channel: null, publication: null, unavailableReason: null,
    })
    await expect(handleHybridExactHistoryOverride(
      new Request('https://example.test/api/transactions/TX1'), env(),
    )).resolves.toBeNull()
  })

  it('returns explicit unavailable when hybrid exact index is absent', async () => {
    source.mockResolvedValue(hybrid(false))
    const response = await handleHybridExactHistoryOverride(
      new Request('https://example.test/api/search?q=LOAN1'), env(),
    )
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ reason: 'history_exact_index_unavailable' })
  })

  it('serves hybrid transaction detail through the existing response shape', async () => {
    source.mockResolvedValue(hybrid())
    transaction.mockResolvedValue({
      transactionHash: 'TX1',
      event: {
        eventHash: 'TX1', epochId: 'epoch-1', ledgerIndex: 105, eventIndex: 1,
        closeTime: 800_000_000, eventType: 'LoanPay', resultCode: 'tesSUCCESS',
        payloadRetained: false, sourceJson: null, metadataJson: null,
        createdAt: '2025-05-08T06:13:20.000Z',
      },
      changes: [],
    })
    const response = await handleHybridExactHistoryOverride(
      new Request('https://example.test/api/transactions/TX1'), env(),
    )
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({
      transaction_hash: 'TX1', found: true,
      event: { transaction_hash: 'TX1', ledger_index: 105 },
    })
  })

  it('serves hybrid exact history search through the existing response shape', async () => {
    source.mockResolvedValue(hybrid())
    search.mockResolvedValue([{
      kind: 'object_change', epochId: 'epoch-1', ledgerIndex: 105,
      transactionHash: 'TX1', objectType: 'Loan', objectId: 'LOAN1', loanId: 'LOAN1',
    }])
    const response = await handleHybridExactHistoryOverride(
      new Request('https://example.test/api/search?q=LOAN1&limit=10'), env(),
    )
    expect(response?.status).toBe(200)
    const body = await response?.json() as { history: { data: unknown[] }; query: string }
    expect(body.query).toBe('LOAN1')
    expect(body.history.data).toHaveLength(1)
    expect(currentSearch).not.toHaveBeenCalled()
  })
})
