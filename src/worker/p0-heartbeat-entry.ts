import type { Bindings } from './env'
import worker from './entry'
import {
  saveFastLaneShadowRunError,
  saveFastLaneShadowRunHeartbeat,
} from './repositories/fast-lane-shadow-run-metrics'

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

    try {
      if (!worker.scheduled) {
        throw new Error('Wrapped Worker does not expose a scheduled handler')
      }

      return await worker.scheduled(controller, env, executionContext)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error'
      try {
        await saveFastLaneShadowRunError({ db: env.DB, runAt, errorMessage: reason })
      } catch (persistenceError) {
        console.error(JSON.stringify({
          event: 'fast_lane_shadow_error_persistence_failed',
          runAt,
          reason: persistenceError instanceof Error ? persistenceError.message : 'unknown_error',
        }))
      }
      console.error(JSON.stringify({ event: 'fast_lane_shadow_cycle_failed', runAt, reason }))
      throw error
    }
  },
}

export default wrappedWorker
