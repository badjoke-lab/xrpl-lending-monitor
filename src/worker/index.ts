import { Hono, type Context } from 'hono'

import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import { getActiveSnapshot } from './repositories/core-api-repository'
import {
  getCurrentEpoch,
  getSyncState,
} from './repositories/network-status-repository'
import {
  type EntityCollectionKind,
  serializeOverview,
  serializeUnavailableEntityCollection,
} from './serializers/core-api'
import { serializeNetworkStatus } from './serializers/network-status'

const app = new Hono<{ Bindings: Bindings }>()
const DEFAULT_PAGE_LIMIT = 25
const MAX_PAGE_LIMIT = 100

async function loadCoreApiContext(db: D1Database) {
  const [state, epoch, snapshot] = await Promise.all([
    getSyncState(db),
    getCurrentEpoch(db),
    getActiveSnapshot(db),
  ])

  return { state, epoch, snapshot }
}

function parsePageLimit(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_PAGE_LIMIT

  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    return null
  }

  return limit
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

  return context.json(
    serializeNetworkStatus({
      state,
      epoch,
    }),
  )
})

app.get('/api/overview', async (context) => {
  resolveRuntimeConfig(context.env)

  return context.json(serializeOverview(await loadCoreApiContext(context.env.DB)))
})

function entityCollectionHandler(kind: EntityCollectionKind) {
  return async (context: Context<{ Bindings: Bindings }>) => {
    resolveRuntimeConfig(context.env)

    const limit = parsePageLimit(context.req.query('limit'))
    if (limit === null) {
      return context.json(
        {
          error: 'invalid_limit',
          message: `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`,
        },
        400,
      )
    }

    const { epoch, snapshot } = await loadCoreApiContext(context.env.DB)
    return context.json(
      serializeUnavailableEntityCollection({
        kind,
        epoch,
        snapshot,
        page: { limit },
      }),
    )
  }
}

app.get('/api/vaults', entityCollectionHandler('vaults'))
app.get('/api/loan-brokers', entityCollectionHandler('loan_brokers'))
app.get('/api/loans', entityCollectionHandler('loans'))

app.onError((_error, context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json(
      {
        error: 'internal_error',
        message: 'Unexpected server error',
      },
      500,
    )
  }

  return new Response('Internal server error', { status: 500 })
})

app.notFound((context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json(
      {
        error: 'not_found',
        path: context.req.path,
      },
      404,
    )
  }

  return context.env.ASSETS.fetch(context.req.raw)
})

const worker: ExportedHandler<Bindings> = {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext)
  },
  async scheduled(_controller, env) {
    const config = resolveRuntimeConfig(env)
    await refreshNetworkStatus({
      db: env.DB,
      config,
    })
  },
}

export { app }
export default worker
