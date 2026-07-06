import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import { searchGithubCurrentStateExact } from '../repositories/github-current-indexes'
import {
  getHybridTransactionDetail,
  searchHybridHistory,
} from '../repositories/hybrid-exact-history-repository'
import { resolveHistorySource } from '../repositories/history-source'
import {
  isReleaseCurrentStateSource,
  resolveCurrentStateStorage,
} from '../repositories/release-current-state'
import {
  serializeSearchResponse,
  serializeTransactionResponse,
} from '../serializers/history-api'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

function limit(url: URL): number | null {
  const raw = url.searchParams.get('limit')
  if (raw === null) return DEFAULT_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT ? value : null
}

function unavailable(reason: string): Response {
  return Response.json({
    error: 'history_source_unavailable',
    reason,
    message: 'The configured immutable history source could not be verified for exact public reads.',
  }, { status: 503 })
}

export async function handleHybridExactHistoryOverride(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  const isTransaction = url.pathname.startsWith('/api/transactions/')
  const isSearch = url.pathname === '/api/search'
  if (!isTransaction && !isSearch) return null

  const config = resolveRuntimeConfig(env)
  const source = await resolveHistorySource(config)
  if (source.kind === 'd1') return null
  if (source.kind === 'unavailable') return unavailable(source.unavailableReason)
  if (!source.exactIndex) return unavailable('history_exact_index_unavailable')

  if (isTransaction) {
    const transactionHash = decodeURIComponent(url.pathname.slice('/api/transactions/'.length))
    const detail = await getHybridTransactionDetail({
      db: env.DB,
      reader: source.reader,
      exactIndex: source.exactIndex.reader,
      transactionHash,
    })
    if (!detail.event && detail.changes.length === 0) {
      return Response.json({ error: 'not_found', transaction_hash: detail.transactionHash }, { status: 404 })
    }
    return Response.json(serializeTransactionResponse({
      transactionHash: detail.transactionHash,
      event: detail.event,
      changes: detail.changes,
    }))
  }

  const query = url.searchParams.get('q')?.trim()
  if (!query) return Response.json({ error: 'invalid_query', message: 'q is required' }, { status: 400 })
  const pageLimit = limit(url)
  if (pageLimit === null) {
    return Response.json({ error: 'invalid_limit', message: `limit must be an integer from 1 to ${MAX_LIMIT}` }, { status: 400 })
  }
  const [historyResults, currentState] = await Promise.all([
    searchHybridHistory({
      db: env.DB,
      reader: source.reader,
      exactIndex: source.exactIndex.reader,
      query,
      limit: pageLimit,
    }),
    resolveCurrentStateStorage(config, env.DB),
  ])
  const current = currentState.snapshot && isReleaseCurrentStateSource(currentState.source)
    ? await searchGithubCurrentStateExact(currentState.source, currentState.snapshot, query, { limit: pageLimit })
    : null
  return Response.json(serializeSearchResponse({
    query,
    results: historyResults,
    current: current?.data,
    currentNextCursor: current?.nextCursor ?? null,
    currentComplete: current?.complete ?? false,
    limit: pageLimit,
  }))
}
