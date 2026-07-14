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

const FAST_LANE_PASSES_PER_CRON = 8
const SYNTHETIC_PASS_OFFSET_MS = 60_000
const CANONICAL_BRIDGE_PATH = '/api/operator/p0-canonical-bridge'
const CANONICAL_BRIDGE_TOKEN_HEADER = 'x-p0-canonical-bridge-token'
const CANONICAL_BRIDGE_PASSES_PER_INVOCATION = 2

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

async function handleCanonicalBridgeOperator(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== CANONICAL_BRIDGE_PATH) return null
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, {
      status: 405,
      headers: { allow: 'POST' },
    })
  }

  const expectedToken = env.P0_CANONICAL_BRIDGE_TOKEN?.trim()
  if (!expectedToken) return new Response(null, { status: 404 })
  const suppliedToken = request.headers.get(CANONICAL_BRIDGE_TOKEN_HEADER)
  if (suppliedToken !== expectedToken) {
    return Response.json({ error: 'canonical_bridge_authorization_failed' }, { status: 403 })
  }
  if (env.APP_NETWORK !== 'devnet' || env.MAINNET_ENABLED !== 'false') {
    return Response.json({ error: 'canonical_bridge_requires_devnet_only_runtime' }, { status: 409 })
  }

  const runAt = new Date().toISOString()
  try {
    const bridge = await runCanonicalBridgePasses({
      env,
      maxPasses: CANONICAL_BRIDGE_PASSES_PER_INVOCATION,
    })
    const promotion = bridge.bridgeReady
      ? await promoteFastLaneCompactToCanonicalOverlay(env.DB)
      : null
    await pruneFastLaneStorage(env.DB)
    await assertFastLaneStorageCapacity(env.DB)
    return Response.json({
      status: promotion ? 'promoted' : 'bridging',
      runAt,
      bridge,
      promotion,
    })
  } catch (error) {
    const reason = errorReason(error)
    console.error(JSON.stringify({ event: 'canonical_bridge_operator_failed', runAt, reason }))
    return Response.json({
      status: 'failed',
      runAt,
      reason,
    }, { status: 503 })
  }
}

const wrappedWorker: ExportedHandler<Bindings> = {
  ...worker,

  async fetch(request, env, executionContext) {
    const operator = await handleCanonicalBridgeOperator(request, env)
    if (operator) return operator
    if (!worker.fetch) return new Response(null, { status: 404 })
    return worker.fetch(request, env, executionContext)
  },

  async scheduled(controller, env, executionContext) {
    const runAt = new Date().toISOString()

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
