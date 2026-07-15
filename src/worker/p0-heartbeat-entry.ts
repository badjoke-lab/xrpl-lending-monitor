import type { Bindings, FastLaneQueueMessage } from './env'
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

const FAST_LANE_PASSES_PER_QUEUE_MESSAGE = 8
const SYNTHETIC_PASS_OFFSET_MS = 60_000
const FIVE_MINUTE_INTERVAL_MS = 5 * 60_000
const OVERLAY_CAPACITY_CHECK_INTERVAL_MS = 60 * 60_000
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

function shouldCheckCanonicalOverlayCapacity(scheduledTime: number): boolean {
  const previousScheduledTime = scheduledTime - FIVE_MINUTE_INTERVAL_MS
  return Math.floor(scheduledTime / OVERLAY_CAPACITY_CHECK_INTERVAL_MS)
    !== Math.floor(previousScheduledTime / OVERLAY_CAPACITY_CHECK_INTERVAL_MS)
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error'
}

function parseQueueMessage(value: unknown): FastLaneQueueMessage {
  if (!value || typeof value !== 'object') throw new Error('fast-lane queue message is invalid')
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.scheduledTime) || Number(record.scheduledTime) < 0) {
    throw new Error('fast-lane queue scheduledTime is invalid')
  }
  if (typeof record.cron !== 'string' || record.cron.length === 0) {
    throw new Error('fast-lane queue cron is invalid')
  }
  if (typeof record.enqueuedAt !== 'string' || !Number.isFinite(Date.parse(record.enqueuedAt))) {
    throw new Error('fast-lane queue enqueuedAt is invalid')
  }
  return {
    scheduledTime: Number(record.scheduledTime),
    cron: record.cron,
    enqueuedAt: record.enqueuedAt,
  }
}

function syntheticScheduledController(message: FastLaneQueueMessage, pass: number): ScheduledController {
  return {
    scheduledTime: message.scheduledTime + pass * SYNTHETIC_PASS_OFFSET_MS,
    cron: message.cron,
    noRetry: () => undefined,
  } as ScheduledController
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

async function runQueuedFastLaneCycle(options: {
  message: FastLaneQueueMessage
  env: Bindings
  executionContext: ExecutionContext
}): Promise<void> {
  const { message, env, executionContext } = options
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

    await assertFastLaneStorageCapacity(env.DB, {
      includeOverlay: shouldCheckCanonicalOverlayCapacity(message.scheduledTime),
    })

    let caughtUp = false
    for (let pass = 0; pass < FAST_LANE_PASSES_PER_QUEUE_MESSAGE; pass += 1) {
      await worker.scheduled(
        syntheticScheduledController(message, pass),
        env,
        executionContext,
      )
      caughtUp = await fastLaneCaughtUp(env.DB)
      if (caughtUp) break
    }

    if (caughtUp) {
      const promotion = await promoteFastLaneCompactToCanonicalOverlay(env.DB)
      if (promotion) {
        console.log(JSON.stringify({
          event: 'fast_lane_compact_promoted',
          runAt,
          scheduledTime: message.scheduledTime,
          ...promotion,
        }))
      }
    } else {
      console.warn(JSON.stringify({
        event: 'fast_lane_compact_promotion_deferred',
        runAt,
        scheduledTime: message.scheduledTime,
        reason: 'fast_lane_not_caught_up',
      }))
    }

    await pruneFastLaneStorage(env.DB)
    await assertFastLaneStorageCapacity(env.DB, { includeOverlay: false })
    await deleteFastLaneShadowRunHeartbeat({ db: env.DB, runAt })
    console.log(JSON.stringify({
      event: 'fast_lane_queue_message_completed',
      runAt,
      scheduledTime: message.scheduledTime,
      enqueuedAt: message.enqueuedAt,
      caughtUp,
    }))
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
    console.error(JSON.stringify({
      event: 'fast_lane_queue_message_failed',
      runAt,
      scheduledTime: message.scheduledTime,
      reason,
    }))
    throw error
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

  async scheduled(controller, env) {
    const message: FastLaneQueueMessage = {
      scheduledTime: controller.scheduledTime,
      cron: controller.cron,
      enqueuedAt: new Date().toISOString(),
    }
    await env.FAST_LANE_QUEUE.send(message)
    console.log(JSON.stringify({
      event: 'fast_lane_queue_message_enqueued',
      ...message,
    }))
  },

  async queue(batch, env, executionContext) {
    for (const queueMessage of batch.messages) {
      try {
        const message = parseQueueMessage(queueMessage.body)
        await runQueuedFastLaneCycle({ message, env, executionContext })
        queueMessage.ack()
      } catch (error) {
        console.error(JSON.stringify({
          event: 'fast_lane_queue_delivery_failed',
          messageId: queueMessage.id,
          attempts: queueMessage.attempts,
          reason: errorReason(error),
        }))
        queueMessage.retry()
      }
    }
  },
}

export default wrappedWorker
