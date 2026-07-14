import type { Bindings } from './env'
import worker from './entry'
import { saveFastLaneShadowRunHeartbeat } from './repositories/fast-lane-shadow-run-metrics'

const wrappedWorker: ExportedHandler<Bindings> = {
  ...worker,

  async scheduled(controller, env, executionContext) {
    const runAt = new Date().toISOString()

    try {
      await saveFastLaneShadowRunHeartbeat({ db: env.DB, runAt })
    } catch (error) {
      console.error(JSON.stringify({
        event: 'fast_lane_shadow_heartbeat_failed',
        runAt,
        reason: error instanceof Error ? error.message : 'unknown_error',
      }))
    }

    if (!worker.scheduled) {
      throw new Error('Wrapped Worker does not expose a scheduled handler')
    }

    return worker.scheduled(controller, env, executionContext)
  },
}

export default wrappedWorker
