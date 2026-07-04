import { runIncrementalCollectorCycle } from '../collector/incremental/collector-cycle'
import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import { resolveCatchUpRuntimeConfig } from '../shared/catch-up-runtime-config'
import { resolveIncrementalRuntimeConfig } from '../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import { app } from './index'
import { initializeCatchUpFromVerifiedBase } from './operator/catch-up-initialization'
import { verifyLiveContinuation } from './operator/live-continuation-verification'
import { getIncrementalCollectorState } from './repositories/incremental-collector-state'
import { getSyncState } from './repositories/network-status-repository'
import { serializeCollectorStatus } from './serializers/collector-status'

const worker: ExportedHandler<Bindings> = {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/status/collector') {
      const runtimeConfig = resolveRuntimeConfig(env)
      const [collector, sync] = await Promise.all([
        getIncrementalCollectorState(env.DB),
        getSyncState(env.DB),
      ])
      return Response.json(serializeCollectorStatus({
        collector,
        sync,
        staleAfterSeconds: runtimeConfig.staleAfterSeconds,
      }))
    }
    if (
      request.method === 'GET'
      && url.pathname === '/api/status/continuation-verification'
    ) {
      return Response.json(await verifyLiveContinuation(env.DB))
    }
    return app.fetch(request, env, executionContext)
  },
  async scheduled(_controller, env) {
    const runtimeConfig = resolveRuntimeConfig(env)
    await refreshNetworkStatus({ db: env.DB, config: runtimeConfig })

    const catchUpConfig = resolveCatchUpRuntimeConfig(env)
    if (catchUpConfig.initializationEnabled && catchUpConfig.base) {
      await initializeCatchUpFromVerifiedBase({
        db: env.DB,
        base: catchUpConfig.base,
        initializedAt: new Date().toISOString(),
      })
    }

    await runIncrementalCollectorCycle({
      db: env.DB,
      runtimeConfig,
      incrementalConfig: resolveIncrementalRuntimeConfig(env),
    })
  },
}

export default worker
