import type { Bindings } from './env'
import worker from './entry'
import {
  promoteFastLaneCompactToCanonicalOverlay,
  runCanonicalBridgePasses,
} from './operator/fast-lane-canonical-bridge'
import {
  deleteFastLaneShadowRunHeartbeat,
  saveFastLaneShadowRunError,
  saveFastLaneShadowRunHeartbeat,
} from './repositories/fast-lane-shadow-run-metrics'
import {
  assertFastLaneStorageCapacity,
  pruneFastLaneStorage,
} from './repositories/fast-lane-storage-retention'

const FAST_LANE_CRON = '*/5 * * * *'
const CANONICAL_BRIDGE_CRON = '2,7,12,17,22,27,32,37,42,47,52,57 * * * *'
const FAST_LANE_PASSES_PER_CRON = 8
const CANONICAL_BRIDGE_PASSES_PER_CRON = 4
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

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error'
}

async function runCanonicalBridgeInvocation(env: Bindings, runAt: string): Promise<void> {
  const bridge = await runCanonicalBridgePasses({
    env,
    maxPasses: CANONICAL_BRIDGE_PASSES_PER_CRON,
  })
  console.log(JSON.stringify({ event: 'canonical_bridge_cycle', runAt, ...bridge }))
  if (bridge.bridgeReady) {
    const promotion = await promoteFastLaneCompactToCanonicalOverlay(env.DB)
    if (promotion) {
      console.log(JSON.stringify({ event: 'fast_lane_canonical_promotion_bridge', runAt, ...promotion }))
    }
  }
  await pruneFastLaneStorage(env.DB)
  await assertFastLaneStorageCapacity(env.DB)
}

const wrappedWorker: ExportedHandler<Bindings> = {
  ...worker,

  async scheduled(controller, env, executionContext) {
    const runAt = new Date().toISOString()

    if (controller.cron === CANONICAL_BRIDGE_CRON) {
      try {
        await runCanonicalBridgeInvocation(env, runAt)
      } catch (error) {
        console.error(JSON.stringify({
          event: 'canonical_bridge_failed',
          runAt,
          reason: errorReason(error),
        }))
        throw error
      }
      return
    }

    if (controller.cron !== FAST_LANE_CRON) {
      console.warn(JSON.stringify({ event: 'unknown_cron_ignored', runAt, cron: controller.cron }))
      return
    }

    try {
      await saveFastLaneShadowRunHeartbeat({ db: env.DB, runAt })
    } catch (error) {
      console.error(JSON.stringify({
        event: 'fast_lane_shadow_heartbeat_failed',
        runAt,
        reason: errorReason(error),
      }))
    }

    try {
      if (!worker.scheduled) {
        throw new Error('Wrapped Worker does not expose a scheduled handler')
      }

      await assertFastLaneStorageCapacity(env.DB)

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
        const promotion = await promoteFastLaneCompactToCanonicalOverlay(env.DB)
        if (promotion) {
          console.log(JSON.stringify({ event: 'fast_lane_canonical_promotion_after', runAt, ...promotion }))
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: 'fast_lane_canonical_promotion_failed',
          runAt,
          reason: errorReason(error),
        }))
      }

      await pruneFastLaneStorage(env.DB)
      await assertFastLaneStorageCapacity(env.DB)
      await deleteFastLaneShadowRunHeartbeat({ db: env.DB, runAt })
    } catch (error) {
      const reason = errorReason(error)
      try {
        await saveFastLaneShadowRunError({ db: env.DB, runAt, errorMessage: reason })
      } catch (persistenceError) {
        console.error(JSON.stringify({
          event: 'fast_lane_shadow_error_persistence_failed',
          runAt,
          reason: errorReason(persistenceError),
        }))
      }
      console.error(JSON.stringify({ event: 'fast_lane_shadow_cycle_failed', runAt, reason }))
      throw error
    }
  },
}

export default wrappedWorker
