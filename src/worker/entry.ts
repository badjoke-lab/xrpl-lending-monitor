import { runIncrementalCollectorCycle } from '../collector/incremental/collector-cycle'
import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import {
  resolveIncrementalRuntimeConfig,
  type IncrementalRuntimeEnvironment,
} from '../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import { app } from './index'
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
    return app.fetch(request, env, executionContext)
  },
  async scheduled(_controller, env) {
    const runtimeConfig = resolveRuntimeConfig(env)
    await refreshNetworkStatus({ db: env.DB, config: runtimeConfig })
    await runIncrementalCollectorCycle({
      db: env.DB,
      runtimeConfig,
      incrementalConfig: resolveIncrementalRuntimeConfig(
        env as unknown as IncrementalRuntimeEnvironment,
      ),
    })
  },
}

export default worker
