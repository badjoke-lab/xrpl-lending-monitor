import { runIncrementalCollectorCycle } from '../collector/incremental/collector-cycle'
import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import { resolveIncrementalRuntimeConfig } from '../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import { app } from './index'

const worker: ExportedHandler<Bindings> = {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext)
  },
  async scheduled(_controller, env) {
    const runtimeConfig = resolveRuntimeConfig(env)
    await refreshNetworkStatus({ db: env.DB, config: runtimeConfig })
    await runIncrementalCollectorCycle({
      db: env.DB,
      runtimeConfig,
      incrementalConfig: resolveIncrementalRuntimeConfig(env),
    })
  },
}

export default worker
