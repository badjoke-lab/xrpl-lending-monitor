import type { Bindings, FastLaneQueueMessage } from './env'
import { fastLaneQueueFailureDisposition } from './fast-lane-queue-failure'
import worker from './p0-heartbeat-entry'
import { assertFastLaneStorageCapacity } from './repositories/fast-lane-storage-retention'
import { handleHybridExactBalanceHistoryOverride } from './routes/hybrid-exact-balance-history-override'
import { handleHybridTransactionDetail } from './routes/hybrid-transaction-detail'

const FIVE_MINUTE_INTERVAL_MS = 5 * 60_000
const CRON_RESEED_SOURCE = 'cron-five-minute-reseed'

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error'
}

function normalizeScheduledTime(value: number): number {
  return Math.floor(value / FIVE_MINUTE_INTERVAL_MS) * FIVE_MINUTE_INTERVAL_MS
}

function normalizeQueueBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const record = body as Record<string, unknown>
  if (!Number.isSafeInteger(record.scheduledTime)) return body

  const originalScheduledTime = Number(record.scheduledTime)
  const scheduledTime = normalizeScheduledTime(originalScheduledTime)
  if (scheduledTime === originalScheduledTime) return body

  return {
    ...record,
    scheduledTime,
  }
}

function normalizeQueueMessage<T>(message: Message<T>): Message<T> {
  const body = normalizeQueueBody(message.body) as T
  if (body === message.body) return message

  const originalScheduledTime = (message.body as Record<string, unknown>).scheduledTime
  const scheduledTime = (body as Record<string, unknown>).scheduledTime
  console.warn(JSON.stringify({
    event: 'fast_lane_queue_scheduled_time_normalized',
    messageId: message.id,
    originalScheduledTime,
    scheduledTime,
  }))

  return new Proxy(message, {
    get(target, property, receiver) {
      if (property === 'body') return body
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const redundantSchedulerWorker: ExportedHandler<Bindings> = {
  ...worker,

  async fetch(request, env, executionContext) {
    const balanceHistory = await handleHybridExactBalanceHistoryOverride(request, env)
    if (balanceHistory) return balanceHistory
    const transactionDetail = await handleHybridTransactionDetail(request, env)
    if (transactionDetail) return transactionDetail
    if (!worker.fetch) return new Response(null, { status: 404 })
    return worker.fetch(request, env, executionContext)
  },

  async scheduled(controller, env) {
    const scheduledTime = normalizeScheduledTime(controller.scheduledTime)

    try {
      await assertFastLaneStorageCapacity(env.DB, { includeOverlay: false })
    } catch (error) {
      if (fastLaneQueueFailureDisposition(error) === 'ack') {
        console.error(JSON.stringify({
          event: 'fast_lane_cron_reseed_capacity_halt',
          source: CRON_RESEED_SOURCE,
          controllerScheduledTime: controller.scheduledTime,
          scheduledTime,
          reason: errorReason(error),
        }))
        return
      }
      throw error
    }

    const message: FastLaneQueueMessage = {
      scheduledTime,
      cron: controller.cron,
      enqueuedAt: new Date().toISOString(),
    }

    await env.FAST_LANE_QUEUE.send(message)
    console.log(JSON.stringify({
      event: 'fast_lane_queue_message_enqueued',
      source: CRON_RESEED_SOURCE,
      controllerScheduledTime: controller.scheduledTime,
      ...message,
    }))
  },

  async queue(batch, env, executionContext) {
    if (!worker.queue) throw new Error('Wrapped Worker does not expose a queue handler')

    const messages = batch.messages.map(normalizeQueueMessage)
    const normalizedBatch = new Proxy(batch, {
      get(target, property, receiver) {
        if (property === 'messages') return messages
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    return worker.queue(normalizedBatch, env, executionContext)
  },
}

export default redundantSchedulerWorker
