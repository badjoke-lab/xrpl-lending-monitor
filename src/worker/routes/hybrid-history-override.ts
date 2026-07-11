import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import {
  listHybridExactLoanLifecycle,
  listHybridExactLoanLifecycleEvents,
  listHybridExactObjectHistory,
} from '../repositories/hybrid-exact-history-repository'
import {
  listHybridActivity,
  listHybridArchivedObjects,
  listHybridBalanceHistory,
  listHybridLoanLifecycle,
  listHybridLoanLifecycleEvents,
  listHybridObjectHistory,
} from '../repositories/hybrid-history-repository'
import { resolveHistorySource } from '../repositories/history-source'
import {
  serializeActivityCsv,
  serializeActivityNdjson,
  serializeActivityResponse,
  serializeArchivedObjectResponse,
  serializeArchivedObjectsResponse,
  serializeBalanceHistoryResponse,
  serializeLifecycleExplorerResponse,
  serializeLoanLifecycleResponse,
  serializeObjectHistoryResponse,
} from '../serializers/history-api'
import { safeHybridResult, safeNewestFirstHybridResult } from './hybrid-history-safety'

const DEFAULT_PAGE_LIMIT = 25
const MAX_PAGE_LIMIT = 100
const MAX_QUERY_LENGTH = 128
const LIFECYCLE_EVENT_TYPES = new Set([
  'created', 'payment', 'paid', 'impaired', 'unimpaired', 'defaulted', 'deleted', 'updated',
])
const ARCHIVED_OBJECT_TYPES = new Set(['Vault', 'LoanBroker', 'Loan'])
const BALANCE_METRIC_TYPES = new Set([
  'debt_total', 'debt_maximum', 'cover_available', 'loss_unrealized',
  'required_minimum_cover', 'cover_surplus',
])
const BALANCE_SUBJECT_TYPES = new Set(['Vault', 'LoanBroker'])

function isHybridHistoryPath(pathname: string): boolean {
  return pathname === '/api/activity'
    || pathname === '/api/audit/lifecycle'
    || pathname === '/api/audit/archived'
    || pathname.startsWith('/api/audit/archived/')
    || pathname === '/api/audit/cover-loss'
    || pathname === '/api/exports/activity'
    || pathname === '/api/feeds/activity.ndjson'
    || pathname.startsWith('/api/objects/') && pathname.endsWith('/history')
    || pathname.startsWith('/api/loans/') && pathname.endsWith('/lifecycle')
    || pathname.startsWith('/api/transactions/')
    || pathname === '/api/search'
}

function pageLimit(url: URL): number | null {
  const raw = url.searchParams.get('limit')
  if (raw === null) return DEFAULT_PAGE_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= MAX_PAGE_LIMIT ? value : null
}

function invalidLimit(): Response {
  return Response.json({
    error: 'invalid_limit',
    message: `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`,
  }, { status: 400 })
}

function historyUnavailable(reason: string): Response {
  const message = reason === 'bounded_immutable_scan_incomplete'
    ? 'The public history window could not be completed within the bounded read budget.'
    : 'The configured immutable history source could not be verified for public reads.'
  return Response.json({
    error: 'history_source_unavailable',
    reason,
    message,
  }, { status: 503 })
}

function exactLookupUnavailable(): Response {
  return Response.json({
    error: 'history_exact_lookup_unavailable',
    message: 'Exact transaction and cross-history search are unavailable while immutable history indexes are incomplete.',
  }, { status: 503 })
}

function pathParts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
}

export async function handleHybridHistoryOverride(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (!isHybridHistoryPath(url.pathname)) return null

  const config = resolveRuntimeConfig(env)
  const source = await resolveHistorySource(config)
  if (source.kind === 'd1') return null
  if (source.kind === 'unavailable') return historyUnavailable(source.unavailableReason)

  if (url.pathname.startsWith('/api/transactions/') || url.pathname === '/api/search') {
    return exactLookupUnavailable()
  }

  const limit = pageLimit(url)
  if (limit === null) return invalidLimit()
  const common = { db: env.DB, reader: source.reader }

  if (url.pathname === '/api/activity') {
    const result = await listHybridActivity({ ...common, page: { limit } })
    if (!safeNewestFirstHybridResult(result, limit)) return historyUnavailable('bounded_immutable_scan_incomplete')
    return Response.json(serializeActivityResponse(result.items, limit))
  }

  if (url.pathname === '/api/exports/activity' || url.pathname === '/api/feeds/activity.ndjson') {
    const result = await listHybridActivity({ ...common, page: { limit } })
    if (!safeNewestFirstHybridResult(result, limit)) return historyUnavailable('bounded_immutable_scan_incomplete')
    if (url.pathname === '/api/feeds/activity.ndjson') {
      return new Response(serializeActivityNdjson(result.items), {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      })
    }
    const format = url.searchParams.get('format') ?? 'json'
    if (format === 'json') return Response.json(serializeActivityResponse(result.items, limit))
    if (format === 'ndjson') {
      return new Response(serializeActivityNdjson(result.items), {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      })
    }
    if (format === 'csv') {
      return new Response(serializeActivityCsv(result.items), {
        headers: { 'content-type': 'text/csv; charset=utf-8' },
      })
    }
    return Response.json({ error: 'invalid_format', message: 'format must be json, ndjson, or csv' }, { status: 400 })
  }

  const parts = pathParts(url.pathname)
  if (parts[1] === 'objects' && parts[4] === 'history') {
    const objectType = parts[2] ?? ''
    const objectId = parts[3] ?? ''
    if (source.exactIndex) {
      const changes = await listHybridExactObjectHistory({
        ...common,
        exactIndex: source.exactIndex.reader,
        objectType,
        objectId,
        page: { limit },
      })
      return Response.json(serializeObjectHistoryResponse({ objectType, objectId, changes, limit }))
    }
    const result = await listHybridObjectHistory({ ...common, objectType, objectId, page: { limit } })
    if (!safeNewestFirstHybridResult(result, limit)) return historyUnavailable('bounded_immutable_scan_incomplete')
    return Response.json(serializeObjectHistoryResponse({ objectType, objectId, changes: result.items, limit }))
  }

  if (parts[1] === 'loans' && parts[3] === 'lifecycle') {
    const loanId = parts[2] ?? ''
    if (source.exactIndex) {
      const events = await listHybridExactLoanLifecycle({
        ...common,
        exactIndex: source.exactIndex.reader,
        loanId,
        page: { limit },
      })
      return Response.json(serializeLoanLifecycleResponse({ loanId, events, limit }))
    }
    const result = await listHybridLoanLifecycle({ ...common, loanId, page: { limit } })
    if (!safeHybridResult(result, limit)) return historyUnavailable('bounded_immutable_scan_incomplete')
    return Response.json(serializeLoanLifecycleResponse({ loanId, events: result.items, limit }))
  }

  if (url.pathname === '/api/audit/lifecycle') {
    const eventType = url.searchParams.get('event_type')?.trim() || null
    const loanId = url.searchParams.get('loan_id')?.trim() || null
    if (eventType !== null && !LIFECYCLE_EVENT_TYPES.has(eventType)) {
      return Response.json({
        error: 'invalid_filter',
        message: 'event_type is not a supported lifecycle event type',
      }, { status: 400 })
    }
    if (source.exactIndex && loanId !== null) {
      const events = await listHybridExactLoanLifecycleEvents({
        ...common,
        exactIndex: source.exactIndex.reader,
        list: { limit, eventType, loanId },
      })
      return Response.json(serializeLifecycleExplorerResponse({
        events,
        filters: { eventType, loanId },
        limit,
      }))
    }
    const result = await listHybridLoanLifecycleEvents({
      ...common,
      list: { limit, eventType, loanId },
    })
    if (!safeNewestFirstHybridResult(result, limit)) return historyUnavailable('bounded_immutable_scan_incomplete')
    return Response.json(serializeLifecycleExplorerResponse({
      events: result.items,
      filters: { eventType, loanId },
      limit,
    }))
  }

  if (url.pathname === '/api/audit/archived') {
    const objectType = url.searchParams.get('object_type')?.trim() || null
    const query = url.searchParams.get('q')?.trim() || null
    if (query !== null && query.length > MAX_QUERY_LENGTH) {
      return Response.json({ error: 'invalid_query', message: `q must be at most ${MAX_QUERY_LENGTH} characters` }, { status: 400 })
    }
    if (objectType !== null && !ARCHIVED_OBJECT_TYPES.has(objectType)) {
      return Response.json({
        error: 'invalid_filter',
        message: 'object_type must be Vault, LoanBroker, or Loan',
      }, { status: 400 })
    }
    const result = await listHybridArchivedObjects({ ...common, list: { limit, objectType, query } })
    if (!safeNewestFirstHybridResult(result, limit)) return historyUnavailable('bounded_immutable_scan_incomplete')
    return Response.json(serializeArchivedObjectsResponse({
      archives: result.items,
      filters: { objectType, query },
      limit,
    }))
  }

  if (parts[1] === 'audit' && parts[2] === 'archived' && parts.length === 5) {
    const objectType = parts[3] ?? ''
    const objectId = parts[4] ?? ''
    if (!ARCHIVED_OBJECT_TYPES.has(objectType)) {
      return Response.json({
        error: 'invalid_object_type',
        message: 'objectType must be Vault, LoanBroker, or Loan',
      }, { status: 400 })
    }
    const result = await listHybridArchivedObjects({
      ...common,
      list: { limit: 1, objectType, query: objectId },
    })
    if (!safeHybridResult(result, 1)) return historyUnavailable('bounded_immutable_scan_incomplete')
    const archive = result.items.find((item) => item.objectType === objectType && item.objectId === objectId) ?? null
    return Response.json(
      serializeArchivedObjectResponse({ objectType, objectId, archive }),
      { status: archive ? 200 : 404 },
    )
  }

  if (url.pathname === '/api/audit/cover-loss') {
    const metricType = url.searchParams.get('metric_type')?.trim() || null
    const subjectType = url.searchParams.get('subject_type')?.trim() || null
    const subjectId = url.searchParams.get('subject_id')?.trim() || null
    const assetKey = url.searchParams.get('asset_key')?.trim() || null
    if (metricType !== null && !BALANCE_METRIC_TYPES.has(metricType)) {
      return Response.json({ error: 'invalid_filter', message: 'metric_type is not supported for cover and loss audit' }, { status: 400 })
    }
    if (subjectType !== null && !BALANCE_SUBJECT_TYPES.has(subjectType)) {
      return Response.json({ error: 'invalid_filter', message: 'subject_type must be Vault or LoanBroker' }, { status: 400 })
    }
    if ((subjectId && subjectId.length > MAX_QUERY_LENGTH) || (assetKey && assetKey.length > MAX_QUERY_LENGTH)) {
      return Response.json({ error: 'invalid_query', message: `q must be at most ${MAX_QUERY_LENGTH} characters` }, { status: 400 })
    }
    const result = await listHybridBalanceHistory({
      ...common,
      list: { limit, metricType, subjectType, subjectId, assetKey },
    })
    if (!safeNewestFirstHybridResult(result, limit)) return historyUnavailable('bounded_immutable_scan_incomplete')
    return Response.json(serializeBalanceHistoryResponse({
      records: result.items,
      filters: { metricType, subjectType, subjectId, assetKey },
      limit,
    }))
  }

  return null
}
