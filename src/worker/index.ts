import { Hono, type Context } from 'hono'

import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import { resolveRuntimeConfig, type RuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import {
  CurrentStateObjectReadError,
  getCurrentVaultById,
  listCurrentVaults,
  type VaultSort,
} from './repositories/current-state-object-reader'
import {
  getArchivedObject,
  getEpoch,
  getEpochStats,
  getTransactionDetail,
  listActivity,
  listArchivedObjects,
  listBalanceHistory,
  listEpochs,
  listLoanLifecycle,
  listLoanLifecycleEvents,
  listObjectHistory,
  searchHistory,
} from './repositories/history-api-repository'
import { getCurrentEpoch, getSyncState } from './repositories/network-status-repository'
import { resolveBaseOverlaySnapshotCounts } from './repositories/base-overlay-overview'
import { readResolvedOverlayState } from './repositories/base-overlay-current-reader'
import {
  isReleaseCurrentStateSource,
  resolveCurrentStateStorage,
} from './repositories/release-current-state'
import { searchGithubCurrentStateExact } from './repositories/github-current-indexes'
import { registerCurrentLoanBrokerRoutes } from './routes/current-loan-brokers'
import { registerCurrentStateDiagnosticRoute } from './routes/current-state-diagnostic'
import {
  serializeAvailableVaultCollection,
  serializeOverview,
  serializeUnavailableEntityCollection,
  serializeUnavailableVaultDetail,
  serializeVaultDetail,
} from './serializers/core-api'
import {
  serializeActivityCsv,
  serializeActivityNdjson,
  serializeActivityResponse,
  serializeArchivedObjectResponse,
  serializeArchivedObjectsResponse,
  serializeBalanceHistoryResponse,
  serializeEpochDetailResponse,
  serializeEpochsResponse,
  serializeLifecycleExplorerResponse,
  serializeLoanLifecycleResponse,
  serializeObjectHistoryResponse,
  serializeSearchResponse,
  serializeTransactionResponse,
} from './serializers/history-api'
import { serializeNetworkStatus } from './serializers/network-status'

const app = new Hono<{ Bindings: Bindings }>()
const DEFAULT_PAGE_LIMIT = 25
const MAX_PAGE_LIMIT = 100
const LIFECYCLE_EVENT_TYPES = new Set([
  'created',
  'payment',
  'paid',
  'impaired',
  'unimpaired',
  'defaulted',
  'deleted',
  'updated',
])
const ARCHIVED_OBJECT_TYPES = new Set(['Vault', 'LoanBroker', 'Loan'])
const BALANCE_METRIC_TYPES = new Set([
  'debt_total',
  'debt_maximum',
  'cover_available',
  'loss_unrealized',
  'required_minimum_cover',
  'cover_surplus',
])
const BALANCE_SUBJECT_TYPES = new Set(['Vault', 'LoanBroker'])
const MAX_QUERY_LENGTH = 128
const MAX_CURSOR_LENGTH = 1024

async function loadCoreApiContext(db: D1Database, config: RuntimeConfig) {
  const [state, epoch, currentState] = await Promise.all([
    getSyncState(db),
    getCurrentEpoch(db),
    resolveCurrentStateStorage(config, db),
  ])
  const snapshot = currentState.snapshot
    ? await resolveBaseOverlaySnapshotCounts(db, currentState.snapshot)
    : null
  const overlay = snapshot
    ? await readResolvedOverlayState({ db, snapshot })
    : null
  return { state, epoch, snapshot, overlay, currentState }
}

function parsePageLimit(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_PAGE_LIMIT
  const limit = Number(value)
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE_LIMIT ? limit : null
}

function parseVaultSort(value: string | undefined): VaultSort | null {
  if (value === undefined) return 'id_asc'
  return value === 'id_asc' || value === 'id_desc' ? value : null
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined | null {
  if (value === undefined) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function invalidLimitResponse(context: Context<{ Bindings: Bindings }>) {
  return context.json(
    {
      error: 'invalid_limit',
      message: `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`,
    },
    400,
  )
}

function invalidQueryResponse(context: Context<{ Bindings: Bindings }>) {
  return context.json(
    { error: 'invalid_query', message: `q must be at most ${MAX_QUERY_LENGTH} characters` },
    400,
  )
}

function currentStateReadErrorResponse(
  context: Context<{ Bindings: Bindings }>,
  error: CurrentStateObjectReadError,
) {
  if (error.code === 'invalid_cursor') {
    return context.json({ error: 'invalid_cursor', message: error.message }, 400)
  }
  return context.json(
    {
      error: 'current_state_unavailable',
      code: error.code,
      message: 'The active current-state snapshot could not be verified for public reads.',
    },
    503,
  )
}

app.get('/api/health', (context) => {
  const config = resolveRuntimeConfig(context.env)
  return context.json({
    ok: true,
    service: 'xrpl-lending-monitor',
    network: config.network,
    mainnet_enabled: config.mainnetEnabled,
  })
})

app.get('/api/status', async (context) => {
  resolveRuntimeConfig(context.env)
  const [state, epoch] = await Promise.all([
    getSyncState(context.env.DB),
    getCurrentEpoch(context.env.DB),
  ])
  return context.json(serializeNetworkStatus({ state, epoch }))
})

app.get('/api/overview', async (context) => {
  const config = resolveRuntimeConfig(context.env)
  return context.json(serializeOverview(await loadCoreApiContext(context.env.DB, config)))
})

app.get('/api/vaults', async (context) => {
  const config = resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)

  const sort = parseVaultSort(context.req.query('sort'))
  if (sort === null) {
    return context.json({ error: 'invalid_sort', message: 'sort must be id_asc or id_desc' }, 400)
  }

  const query = context.req.query('q')?.trim()
  if (query && query.length > MAX_QUERY_LENGTH) {
    return context.json(
      { error: 'invalid_query', message: `q must be at most ${MAX_QUERY_LENGTH} characters` },
      400,
    )
  }

  const cursor = context.req.query('cursor')
  if (cursor && cursor.length > MAX_CURSOR_LENGTH) {
    return context.json(
      { error: 'invalid_cursor', message: `cursor must be at most ${MAX_CURSOR_LENGTH} characters` },
      400,
    )
  }

  const hasLoss = parseOptionalBoolean(context.req.query('has_loss'))
  if (hasLoss === null) {
    return context.json(
      { error: 'invalid_filter', message: 'has_loss must be true or false' },
      400,
    )
  }

  const [epoch, currentState] = await Promise.all([
    getCurrentEpoch(context.env.DB),
    resolveCurrentStateStorage(config, context.env.DB),
  ])
  const snapshot = currentState.snapshot
  if (!snapshot) {
    return context.json(
      serializeUnavailableEntityCollection({
        kind: 'vaults',
        epoch,
        snapshot,
        page: { limit },
      }),
    )
  }

  try {
    const result = await listCurrentVaults(currentState.source, snapshot, {
      limit,
      cursor,
      sort,
      query: query || undefined,
      hasLoss,
    })
    return context.json(
      serializeAvailableVaultCollection({
        epoch,
        snapshot,
        result,
        page: { limit },
        sort,
        query: query || undefined,
        hasLoss,
      }),
    )
  } catch (error) {
    if (error instanceof CurrentStateObjectReadError) {
      return currentStateReadErrorResponse(context, error)
    }
    throw error
  }
})

app.get('/api/vaults/:vaultId', async (context) => {
  const config = resolveRuntimeConfig(context.env)
  const vaultId = context.req.param('vaultId').toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(vaultId)) {
    return context.json(
      { error: 'invalid_identifier', message: 'vaultId must be a 64-character hexadecimal ID' },
      400,
    )
  }

  const [epoch, currentState] = await Promise.all([
    getCurrentEpoch(context.env.DB),
    resolveCurrentStateStorage(config, context.env.DB),
  ])
  const snapshot = currentState.snapshot
  if (!snapshot) {
    return context.json(serializeUnavailableVaultDetail({ epoch, snapshot }))
  }

  try {
    const vault = await getCurrentVaultById(currentState.source, snapshot, vaultId)
    if (!vault) {
      return context.json(
        { error: 'not_found', kind: 'vault', id: vaultId, snapshot_id: snapshot.id },
        404,
      )
    }
    return context.json(serializeVaultDetail({ epoch, snapshot, vault }))
  } catch (error) {
    if (error instanceof CurrentStateObjectReadError) {
      return currentStateReadErrorResponse(context, error)
    }
    throw error
  }
})

registerCurrentLoanBrokerRoutes(app)
registerCurrentStateDiagnosticRoute(app)

app.get('/api/activity', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  return context.json(serializeActivityResponse(await listActivity(context.env.DB, { limit }), limit))
})

app.get('/api/transactions/:hash', async (context) => {
  resolveRuntimeConfig(context.env)
  const transactionHash = context.req.param('hash')
  const detail = await getTransactionDetail(context.env.DB, transactionHash)
  if (!detail.event && detail.changes.length === 0) {
    return context.json({ error: 'not_found', transaction_hash: transactionHash }, 404)
  }
  return context.json(
    serializeTransactionResponse({
      transactionHash,
      event: detail.event,
      changes: detail.changes,
    }),
  )
})

app.get('/api/epochs', async (context) => {
  resolveRuntimeConfig(context.env)
  return context.json(serializeEpochsResponse(await listEpochs(context.env.DB)))
})

app.get('/api/epochs/:epochId', async (context) => {
  resolveRuntimeConfig(context.env)
  const epochId = context.req.param('epochId')
  if (epochId.length > MAX_QUERY_LENGTH) return invalidQueryResponse(context)
  const epoch = await getEpoch(context.env.DB, epochId)
  if (!epoch) return context.json(serializeEpochDetailResponse({ epochId, epoch: null, stats: null }), 404)
  const stats = await getEpochStats(context.env.DB, epochId)
  return context.json(serializeEpochDetailResponse({ epochId, epoch, stats }))
})

app.get('/api/objects/:objectType/:objectId/history', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  const objectType = context.req.param('objectType')
  const objectId = context.req.param('objectId')
  return context.json(
    serializeObjectHistoryResponse({
      objectType,
      objectId,
      changes: await listObjectHistory(context.env.DB, objectType, objectId, { limit }),
      limit,
    }),
  )
})

app.get('/api/loans/:loanId/lifecycle', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  const loanId = context.req.param('loanId')
  return context.json(
    serializeLoanLifecycleResponse({
      loanId,
      events: await listLoanLifecycle(context.env.DB, loanId, { limit }),
      limit,
    }),
  )
})

app.get('/api/audit/lifecycle', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  const eventType = context.req.query('event_type')?.trim() || null
  const loanId = context.req.query('loan_id')?.trim() || null
  if (eventType !== null && !LIFECYCLE_EVENT_TYPES.has(eventType)) {
    return context.json(
      { error: 'invalid_filter', message: 'event_type is not a supported lifecycle event type' },
      400,
    )
  }
  return context.json(
    serializeLifecycleExplorerResponse({
      events: await listLoanLifecycleEvents(context.env.DB, { limit, eventType, loanId }),
      filters: { eventType, loanId },
      limit,
    }),
  )
})

app.get('/api/audit/archived', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  const objectType = context.req.query('object_type')?.trim() || null
  const query = context.req.query('q')?.trim() || null
  if (query !== null && query.length > MAX_QUERY_LENGTH) return invalidQueryResponse(context)
  if (objectType !== null && !ARCHIVED_OBJECT_TYPES.has(objectType)) {
    return context.json(
      { error: 'invalid_filter', message: 'object_type must be Vault, LoanBroker, or Loan' },
      400,
    )
  }
  return context.json(
    serializeArchivedObjectsResponse({
      archives: await listArchivedObjects(context.env.DB, { limit, objectType, query }),
      filters: { objectType, query },
      limit,
    }),
  )
})

app.get('/api/audit/archived/:objectType/:objectId', async (context) => {
  resolveRuntimeConfig(context.env)
  const objectType = context.req.param('objectType')
  const objectId = context.req.param('objectId')
  if (!ARCHIVED_OBJECT_TYPES.has(objectType)) {
    return context.json(
      { error: 'invalid_object_type', message: 'objectType must be Vault, LoanBroker, or Loan' },
      400,
    )
  }
  const archive = await getArchivedObject(context.env.DB, objectType, objectId)
  if (!archive) {
    return context.json(
      serializeArchivedObjectResponse({ objectType, objectId, archive: null }),
      404,
    )
  }
  return context.json(serializeArchivedObjectResponse({ objectType, objectId, archive }))
})

app.get('/api/audit/cover-loss', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  const metricType = context.req.query('metric_type')?.trim() || null
  const subjectType = context.req.query('subject_type')?.trim() || null
  const subjectId = context.req.query('subject_id')?.trim() || null
  const assetKey = context.req.query('asset_key')?.trim() || null
  if (metricType !== null && !BALANCE_METRIC_TYPES.has(metricType)) {
    return context.json(
      { error: 'invalid_filter', message: 'metric_type is not supported for cover and loss audit' },
      400,
    )
  }
  if (subjectType !== null && !BALANCE_SUBJECT_TYPES.has(subjectType)) {
    return context.json(
      { error: 'invalid_filter', message: 'subject_type must be Vault or LoanBroker' },
      400,
    )
  }
  if ((subjectId !== null && subjectId.length > MAX_QUERY_LENGTH) || (assetKey !== null && assetKey.length > MAX_QUERY_LENGTH)) {
    return invalidQueryResponse(context)
  }
  return context.json(
    serializeBalanceHistoryResponse({
      records: await listBalanceHistory(context.env.DB, { limit, metricType, subjectType, subjectId, assetKey }),
      filters: { metricType, subjectType, subjectId, assetKey },
      limit,
    }),
  )
})

app.get('/api/search', async (context) => {
  const config = resolveRuntimeConfig(context.env)
  const query = context.req.query('q')?.trim()
  if (!query) {
    return context.json({ error: 'invalid_query', message: 'q is required' }, 400)
  }
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  const [historyResults, currentState] = await Promise.all([
    searchHistory(context.env.DB, query, { limit }),
    resolveCurrentStateStorage(config, context.env.DB),
  ])
  const current = currentState.snapshot && isReleaseCurrentStateSource(currentState.source)
    ? await searchGithubCurrentStateExact(currentState.source, currentState.snapshot, query, { limit })
    : null
  return context.json(
    serializeSearchResponse({
      query,
      results: historyResults,
      current: current?.data,
      currentNextCursor: current?.nextCursor ?? null,
      currentComplete: current?.complete ?? false,
      limit,
    }),
  )
})

app.get('/api/exports/activity', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  const format = context.req.query('format') ?? 'json'
  const events = await listActivity(context.env.DB, { limit })
  if (format === 'json') return context.json(serializeActivityResponse(events, limit))
  if (format === 'ndjson') {
    return new Response(serializeActivityNdjson(events), {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    })
  }
  if (format === 'csv') {
    return new Response(serializeActivityCsv(events), {
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    })
  }
  return context.json(
    { error: 'invalid_format', message: 'format must be json, ndjson, or csv' },
    400,
  )
})

app.get('/api/feeds/activity.ndjson', async (context) => {
  resolveRuntimeConfig(context.env)
  const limit = parsePageLimit(context.req.query('limit'))
  if (limit === null) return invalidLimitResponse(context)
  return new Response(serializeActivityNdjson(await listActivity(context.env.DB, { limit })), {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  })
})

function serveApiDocumentation(context: Context<{ Bindings: Bindings }>) {
  const assetUrl = new URL('/', context.req.url)
  return context.env.ASSETS.fetch(new Request(assetUrl.toString()))
}

app.get('/api', serveApiDocumentation)
app.get('/api/', serveApiDocumentation)

app.onError((_error, context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json(
      { error: 'internal_error', message: 'Unexpected server error' },
      500,
    )
  }
  return new Response('Internal server error', { status: 500 })
})

app.notFound((context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json({ error: 'not_found', path: context.req.path }, 404)
  }
  return context.env.ASSETS.fetch(context.req.raw)
})

const worker: ExportedHandler<Bindings> = {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext)
  },
  async scheduled(_controller, env) {
    const config = resolveRuntimeConfig(env)
    await refreshNetworkStatus({ db: env.DB, config })
  },
}

export { app }
export default worker
