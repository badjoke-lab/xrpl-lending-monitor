import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import { listHybridExactBalanceHistory } from '../repositories/hybrid-exact-balance-history-repository'
import { resolveHistorySource } from '../repositories/history-source'
import { serializeBalanceHistoryResponse } from '../serializers/history-api'

const DEFAULT_PAGE_LIMIT = 25
const MAX_PAGE_LIMIT = 100
const MAX_QUERY_LENGTH = 128
const BALANCE_METRIC_TYPES = new Set([
  'debt_total', 'debt_maximum', 'cover_available', 'loss_unrealized',
  'required_minimum_cover', 'cover_surplus',
])
const BALANCE_SUBJECT_TYPES = new Set(['Vault', 'LoanBroker'])

function pageLimit(url: URL): number | null {
  const raw = url.searchParams.get('limit')
  if (raw === null) return DEFAULT_PAGE_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= MAX_PAGE_LIMIT ? value : null
}

export async function handleHybridExactBalanceHistoryOverride(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.pathname !== '/api/audit/cover-loss') return null

  const subjectId = url.searchParams.get('subject_id')?.trim() || null
  if (subjectId === null) return null
  const metricType = url.searchParams.get('metric_type')?.trim() || null
  const subjectType = url.searchParams.get('subject_type')?.trim() || null
  const assetKey = url.searchParams.get('asset_key')?.trim() || null
  const limit = pageLimit(url)

  if (limit === null) {
    return Response.json({
      error: 'invalid_limit',
      message: `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`,
    }, { status: 400 })
  }
  if (metricType !== null && !BALANCE_METRIC_TYPES.has(metricType)) {
    return Response.json({
      error: 'invalid_filter',
      message: 'metric_type is not supported for cover and loss audit',
    }, { status: 400 })
  }
  if (subjectType !== null && !BALANCE_SUBJECT_TYPES.has(subjectType)) {
    return Response.json({
      error: 'invalid_filter',
      message: 'subject_type must be Vault or LoanBroker',
    }, { status: 400 })
  }
  if (subjectId.length > MAX_QUERY_LENGTH || (assetKey && assetKey.length > MAX_QUERY_LENGTH)) {
    return Response.json({
      error: 'invalid_query',
      message: `q must be at most ${MAX_QUERY_LENGTH} characters`,
    }, { status: 400 })
  }

  const source = await resolveHistorySource(resolveRuntimeConfig(env))
  if (source.kind !== 'hybrid' || !source.exactIndex) return null

  const records = await listHybridExactBalanceHistory({
    db: env.DB,
    reader: source.reader,
    exactIndex: source.exactIndex.reader,
    list: { limit, metricType, subjectType, subjectId, assetKey },
  })
  return Response.json(serializeBalanceHistoryResponse({
    records,
    filters: { metricType, subjectType, subjectId, assetKey },
    limit,
  }))
}
