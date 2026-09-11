import { runBoundedIncrementalCollectorCycle } from '../collector/incremental/bounded-collector-cycle'
import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import {
  resolveIncrementalRuntimeConfig,
  type IncrementalRuntimeEnvironment,
} from '../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import { app } from './index'

const currentDirectWorker: ExportedHandler<Bindings> = {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext)
  },

  async scheduled(_controller, env) {
    const runtimeConfig = resolveRuntimeConfig(env)
    await refreshNetworkStatus({ db: env.DB, config: runtimeConfig })
    await runBoundedIncrementalCollectorCycle({
      db: env.DB,
      runtimeConfig,
      incrementalConfig: resolveIncrementalRuntimeConfig(
        env as unknown as IncrementalRuntimeEnvironment,
      ),
    })
  },
}

export default currentDirectWorker
