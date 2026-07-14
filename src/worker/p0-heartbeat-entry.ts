import type { Bindings } from './env'
import worker from './entry'
import {
  deleteFastLaneShadowRunHeartbeat,
  saveFastLaneShadowRunError,
  saveFastLaneShadowRunHeartbeat,
} from './repositories/fast-lane-shadow-run-metrics'
import { pruneFastLaneStorage } from './repositories/fast-lane-storage-retention'

const FAST_LANE_PASSES_PER_CRON = 8
const SYNTHETIC_PASS_OFFSET_MS = 60_000

interface FastLaneStateRow {
  last_processed_ledger: number
  latest_observed_ledger: number
}

async function fastLaneCaughtUp(db: D1Database): Promise<boolean> {
  const row = await db.prepare(
    `SELECT last_processed_ledger, latest_observed_ledger
     FROM fast_lane_shadow_state
     WHERE network = 'devnet'`,
  ).first<FastLaneStateRow>()
  return Boolean(row && row.last_processed_ledger >= row.latest_observed_ledger)
}

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

      for (let pass = 0; pass < FAST_LANE_PASSES_PER_CRON; pass += 1) {
        const passController = pass === 0
          ? controller
          : {
              scheduledTime: controller.scheduledTime + pass * SYNTHETIC_PASS_OFFSET_MS,
              cron: controller.cron,
              noRetry: () => controller.noRetry(),
            } as typeof controller

        await worker.scheduled(passController, env, executionContext)
        if (await fastLaneCaughtUp(env.DB)) break
      }

      try {
        await pruneFastLaneStorage(env.DB)
      } catch (error) {
        console.error(JSON.stringify({
          event: 'fast_lane_storage_retention_failed',
          runAt,
          reason: error instanceof Error ? error.message : 'unknown_error',
        }))
      }

      await deleteFastLaneShadowRunHeartbeat({ db: env.DB, runAt })
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
