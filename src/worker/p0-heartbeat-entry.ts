import type { Bindings, FastLaneQueueMessage } from './env'
import { fastLanePassScheduledTime } from './fast-lane-pass-cadence'
import { fastLaneQueueFailureDisposition } from './fast-lane-queue-failure'
import worker from './entry'
import {
  promoteFastLaneCompactToCanonicalOverlay,
  runCanonicalBridgePasses,
} from './operator/fast-lane-canonical-bridge'
import {
  claimFastLaneQueueSlot,
  completeFastLaneQueueSlot,
  markFastLaneQueueSlotError,
  pruneFastLaneQueueSlots,
  readFastLaneQueueSlot,
  stageFastLaneQueueSuccessor,
} from './repositories/fast-lane-queue-slot'
import {
  deleteFastLaneShadowRunHeartbeat,
  saveFastLaneShadowRunError,
  saveFastLaneShadowRunHeartbeat,
} from './repositories/fast-lane-shadow-run-metrics'
import {
  assertFastLaneStorageCapacity,
  pruneFastLaneStorage,
} from './repositories/fast-lane-storage-retention'

export const FAST_LANE_PASSES_PER_QUEUE_MESSAGE = 1
export const FAST_LANE_QUEUE_PROCESSING_LEASE_MS = 15 * 60_000
const FIVE_MINUTE_INTERVAL_MS = 5 * 60_000
const OVERLAY_CAPACITY_CHECK_INTERVAL_MS = 60 * 60_000
const QUEUE_SLOT_RETENTION_MS = 7 * 24 * 60 * 60_000
const SELF_SCHEDULE_CRON = 'queue-self-schedule'
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
    scheduledTime: fastLanePassScheduledTime(message.scheduledTime, pass),
    cron: message.cron,
    noRetry: () => undefined,
  } as ScheduledController
}

function nextFiveMinuteSlot(currentScheduledTime: number, now: number): number {
  const nextFromCurrent = currentScheduledTime + FIVE_MINUTE_INTERVAL_MS
  const nextWallClockBoundary = Math.ceil((now + 1_000) / FIVE_MINUTE_INTERVAL_MS)
    * FIVE_MINUTE_INTERVAL_MS
  return Math.max(nextFromCurrent, nextWallClockBoundary)
}

function delaySecondsUntil(scheduledTime: number, now: number): number {
  return Math.max(1, Math.ceil((scheduledTime - now) / 1_000))
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
}): Promise<boolean> {
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
    return caughtUp
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
    try {
      await assertFastLaneStorageCapacity(env.DB, { includeOverlay: false })
    } catch (error) {
      if (fastLaneQueueFailureDisposition(error) === 'ack') {
        console.error(JSON.stringify({
          event: 'fast_lane_scheduled_capacity_halt',
          source: 'scheduled-fallback',
          scheduledTime: controller.scheduledTime,
          reason: errorReason(error),
        }))
        return
      }
      throw error
    }

    const message: FastLaneQueueMessage = {
      scheduledTime: controller.scheduledTime,
      cron: SELF_SCHEDULE_CRON,
      enqueuedAt: new Date().toISOString(),
    }
    await env.FAST_LANE_QUEUE.send(message)
    console.log(JSON.stringify({
      event: 'fast_lane_queue_message_enqueued',
      source: 'scheduled-fallback',
      ...message,
    }))
  },

  async queue(batch, env, executionContext) {
    for (const queueMessage of batch.messages) {
      let message: FastLaneQueueMessage | null = null
      try {
        message = parseQueueMessage(queueMessage.body)

        await assertFastLaneStorageCapacity(env.DB, {
          includeOverlay: shouldCheckCanonicalOverlayCapacity(message.scheduledTime),
        })

        const claimedAt = new Date().toISOString()
        const staleBefore = new Date(
          Date.parse(claimedAt) - FAST_LANE_QUEUE_PROCESSING_LEASE_MS,
        ).toISOString()
        const claimed = await claimFastLaneQueueSlot({
          db: env.DB,
          scheduledTime: message.scheduledTime,
          messageId: queueMessage.id,
          claimedAt,
          staleBefore,
        })
        if (claimed === 'duplicate') {
          console.warn(JSON.stringify({
            event: 'fast_lane_queue_duplicate_ignored',
            messageId: queueMessage.id,
            scheduledTime: message.scheduledTime,
          }))
          queueMessage.ack()
          continue
        }

        const pendingSlot = claimed === 'successor_pending'
          ? await readFastLaneQueueSlot({ db: env.DB, scheduledTime: message.scheduledTime })
          : null
        const caughtUp = claimed === 'claimed'
          ? await runQueuedFastLaneCycle({ message, env, executionContext })
          : false
        const now = Date.now()
        const nextScheduledTime = claimed === 'successor_pending'
          ? pendingSlot?.nextScheduledTime
          : nextFiveMinuteSlot(message.scheduledTime, now)
        if (nextScheduledTime === null || nextScheduledTime === undefined) {
          throw new Error('fast-lane Queue pending successor is unavailable')
        }
        const nextMessage: FastLaneQueueMessage = {
          scheduledTime: nextScheduledTime,
          cron: SELF_SCHEDULE_CRON,
          enqueuedAt: new Date(now).toISOString(),
        }
        const delaySeconds = delaySecondsUntil(nextScheduledTime, now)
        if (claimed === 'claimed') {
          await stageFastLaneQueueSuccessor({
            db: env.DB,
            scheduledTime: message.scheduledTime,
            messageId: queueMessage.id,
            nextScheduledTime,
            updatedAt: new Date().toISOString(),
          })
        }
        await env.FAST_LANE_QUEUE.send(nextMessage, { delaySeconds })
        await completeFastLaneQueueSlot({
          db: env.DB,
          scheduledTime: message.scheduledTime,
          messageId: pendingSlot?.messageId ?? queueMessage.id,
          nextScheduledTime,
          completedAt: new Date().toISOString(),
        })
        await pruneFastLaneQueueSlots({
          db: env.DB,
          cutoff: new Date(Date.now() - QUEUE_SLOT_RETENTION_MS).toISOString(),
        })
        console.log(JSON.stringify({
          event: 'fast_lane_queue_next_scheduled',
          messageId: queueMessage.id,
          scheduledTime: message.scheduledTime,
          nextScheduledTime,
          delaySeconds,
          caughtUp,
        }))
        queueMessage.ack()
      } catch (error) {
        const reason = errorReason(error)
        const disposition = fastLaneQueueFailureDisposition(error)

        if (message) {
          try {
            await markFastLaneQueueSlotError({
              db: env.DB,
              scheduledTime: message.scheduledTime,
              messageId: queueMessage.id,
              errorMessage: reason,
              updatedAt: new Date().toISOString(),
            })
          } catch (slotError) {
            console.error(JSON.stringify({
              event: 'fast_lane_queue_slot_error_persistence_failed',
              messageId: queueMessage.id,
              reason: errorReason(slotError),
            }))
          }
        }
        console.error(JSON.stringify({
          event: 'fast_lane_queue_delivery_failed',
          messageId: queueMessage.id,
          attempts: queueMessage.attempts,
          scheduledTime: message?.scheduledTime ?? null,
          reason,
        }))
        if (disposition === 'ack') {
          console.error(JSON.stringify({
            event: 'fast_lane_queue_terminal_capacity_halt',
            messageId: queueMessage.id,
            scheduledTime: message?.scheduledTime ?? null,
            reason,
          }))
          queueMessage.ack()
          continue
        }

        queueMessage.retry()
      }
    }
  },
}

export default wrappedWorker
