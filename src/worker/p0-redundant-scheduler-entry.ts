import type { Bindings, FastLaneQueueMessage } from './env'
import worker from './p0-heartbeat-entry'

const CRON_RESEED_SOURCE = 'cron-five-minute-reseed'

const redundantSchedulerWorker: ExportedHandler<Bindings> = {
  ...worker,

  async scheduled(controller, env) {
    const message: FastLaneQueueMessage = {
      scheduledTime: controller.scheduledTime,
      cron: controller.cron,
      enqueuedAt: new Date().toISOString(),
    }

    await env.FAST_LANE_QUEUE.send(message)
    console.log(JSON.stringify({
      event: 'fast_lane_queue_message_enqueued',
      source: CRON_RESEED_SOURCE,
      ...message,
    }))
  },
}

export default redundantSchedulerWorker
