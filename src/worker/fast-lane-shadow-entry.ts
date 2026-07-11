import { runFastLaneShadowCycle } from '../collector/incremental/fast-lane-shadow-cycle'
import {
  resolveFastLaneShadowRuntimeConfig,
  type FastLaneShadowRuntimeEnvironment,
} from '../shared/fast-lane-shadow-runtime-config'
import { resolveRuntimeConfig, type RuntimeEnvironment } from '../shared/runtime-config'

interface FastLaneShadowBindings extends RuntimeEnvironment, FastLaneShadowRuntimeEnvironment {
  DB: D1Database
}

const worker: ExportedHandler<FastLaneShadowBindings> = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname !== '/status') {
      return new Response('Not Found', { status: 404 })
    }

    const state = await env.DB
      .prepare(
        `SELECT epoch_id, last_processed_ledger, last_processed_hash,
                latest_observed_ledger, latest_observed_hash, status, updated_at
         FROM fast_lane_shadow_state
         WHERE network = 'devnet'`,
      )
      .first<Record<string, unknown>>()

    return Response.json({
      mode: 'fast-lane-shadow',
      scheduleTargetSeconds: 300,
      state,
    })
  },

  async scheduled(_controller, env) {
    const result = await runFastLaneShadowCycle({
      db: env.DB,
      runtimeConfig: resolveRuntimeConfig(env),
      fastLaneConfig: resolveFastLaneShadowRuntimeConfig(env),
    })
    console.log(JSON.stringify({ event: 'fast_lane_shadow_cycle', ...result }))
  },
}

export default worker
