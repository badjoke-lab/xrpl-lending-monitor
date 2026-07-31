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
    return worker.queue(batch, env, executionContext)
  },
}

export default redundantSchedulerWorker
