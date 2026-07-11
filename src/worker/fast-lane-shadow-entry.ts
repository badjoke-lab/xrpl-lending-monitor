import { runFastLaneShadowCycle } from '../collector/incremental/fast-lane-shadow-cycle'
import {
  resolveFastLaneShadowRuntimeConfig,
  type FastLaneShadowRuntimeEnvironment,
} from '../shared/fast-lane-shadow-runtime-config'
import {
  resolveReplacementBaseRuntimeConfig,
  type ReplacementBaseRuntimeEnvironment,
} from '../shared/replacement-base-runtime-config'
import { resolveRuntimeConfig, type RuntimeEnvironment } from '../shared/runtime-config'
import {
  readRecentFastLaneShadowRunMetrics,
  saveFastLaneShadowRunMetric,
} from './repositories/fast-lane-shadow-run-metrics'

interface FastLaneShadowBindings
  extends RuntimeEnvironment,
    FastLaneShadowRuntimeEnvironment,
    ReplacementBaseRuntimeEnvironment {
  DB: D1Database
}

const worker: ExportedHandler<FastLaneShadowBindings> = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname !== '/status') {
      return new Response('Not Found', { status: 404 })
    }

    const [state, recentRuns] = await Promise.all([
      env.DB
        .prepare(
          `SELECT epoch_id, last_processed_ledger, last_processed_hash,
                  latest_observed_ledger, latest_observed_hash, status, updated_at
           FROM fast_lane_shadow_state
           WHERE network = 'devnet'`,
        )
        .first<Record<string, unknown>>(),
      readRecentFastLaneShadowRunMetrics({ db: env.DB, limit: 24 }),
    ])

    return Response.json({
      mode: 'fast-lane-shadow',
      scheduleTargetSeconds: 300,
      state,
      recentRuns,
    })
  },

  async scheduled(_controller, env) {
    const runAt = new Date().toISOString()
    const base = resolveReplacementBaseRuntimeConfig(env).target
    if (!base) throw new Error('Fast-lane shadow requires the canonical replacement base target')
    const result = await runFastLaneShadowCycle({
      db: env.DB,
      runtimeConfig: resolveRuntimeConfig(env),
      fastLaneConfig: resolveFastLaneShadowRuntimeConfig(env),
      base,
    })
    await saveFastLaneShadowRunMetric({ db: env.DB, runAt, result })
    console.log(JSON.stringify({ event: 'fast_lane_shadow_cycle', runAt, ...result }))
  },
}

export default worker
