import { runBoundedIncrementalCollectorCycle } from '../collector/incremental/bounded-collector-cycle'
import { refreshNetworkStatus } from '../collector/network/refresh-network-status'
import {
  resolveIncrementalRuntimeConfig,
  type IncrementalRuntimeEnvironment,
} from '../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../shared/runtime-config'
import type { Bindings } from './env'
import baseWorker from './entry'
import { handleHybridExactBalanceHistoryOverride } from './routes/hybrid-exact-balance-history-override'
import { handleHybridTransactionDetail } from './routes/hybrid-transaction-detail'

const currentDirectWorker: ExportedHandler<Bindings> = {
  async fetch(request, env, executionContext) {
    const balanceHistory = await handleHybridExactBalanceHistoryOverride(request, env)
    if (balanceHistory) return balanceHistory

    const transactionDetail = await handleHybridTransactionDetail(request, env)
    if (transactionDetail) return transactionDetail

    if (!baseWorker.fetch) return new Response(null, { status: 404 })
    return baseWorker.fetch(request, env, executionContext)
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
