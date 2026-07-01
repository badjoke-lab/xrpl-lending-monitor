import { Hono } from 'hono'

import { collectCurrentState } from '../collector/current-state/collect-current-state'
import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import {
  getCurrentEpoch,
  getSyncState,
} from './repositories/network-status-repository'
import { serializeNetworkStatus } from './serializers/network-status'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/health', (context) => {
  const config = resolveRuntimeConfig(context.env)

  return context.json({
    ok: true,
    service: 'xrpl-lending-monitor',
    network: config.network,
    mainnet_enabled: config.mainnetEnabled,
    current_state_collection_enabled: config.currentStateCollectionEnabled,
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

    if (config.currentStateCollectionEnabled) {
      await collectCurrentState({
        db: env.DB,
        config,
        pageLimitPerType: config.currentScanPageLimitPerType,
        requestLimitTotal: config.currentScanRequestLimitTotal,
        writeBatchSize: config.currentScanWriteBatchSize,
      })
    }
  },
}

export { app }
export default worker
