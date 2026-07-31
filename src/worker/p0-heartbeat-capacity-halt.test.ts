import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings, FastLaneQueueMessage } from './env'
import wrappedWorker, { FAST_LANE_QUEUE_RETRY_DELAY_SECONDS } from './p0-heartbeat-entry'
import { FAST_LANE_CATCH_UP_CRON, FAST_LANE_NORMAL_CRON } from './fast-lane-successor-cadence'
import { shouldRunProtectedHeavyCycle } from './scheduled-cadence'
import { FastLaneStorageCapacityError } from './repositories/fast-lane-storage-retention'

const mocks = vi.hoisted(() => ({
  assertCapacity: vi.fn(),
  claimSlot: vi.fn(),
  completeSlot: vi.fn(),
  readSlot: vi.fn(),
  stageSuccessor: vi.fn(),
  markSlotError: vi.fn(),
  pruneSlots: vi.fn(),
  pruneStorage: vi.fn(),
  saveHeartbeat: vi.fn(),
  deleteHeartbeat: vi.fn(),
  saveRunError: vi.fn(),
  workerScheduled: vi.fn(),
  promoteCompact: vi.fn(),
  runCanonicalBridge: vi.fn(),
}))

vi.mock('./entry', () => ({
  default: {
    scheduled: mocks.workerScheduled,
  },
}))

vi.mock('./operator/fast-lane-canonical-bridge', () => ({
  promoteFastLaneCompactToCanonicalOverlay: mocks.promoteCompact,
  runCanonicalBridgePasses: mocks.runCanonicalBridge,
}))

vi.mock('./repositories/fast-lane-queue-slot', () => ({
  claimFastLaneQueueSlot: mocks.claimSlot,
  completeFastLaneQueueSlot: mocks.completeSlot,
  markFastLaneQueueSlotError: mocks.markSlotError,
  pruneFastLaneQueueSlots: mocks.pruneSlots,
  readFastLaneQueueSlot: mocks.readSlot,
  stageFastLaneQueueSuccessor: mocks.stageSuccessor,
}))

vi.mock('./repositories/fast-lane-shadow-run-metrics', () => ({
  saveFastLaneShadowRunHeartbeat: mocks.saveHeartbeat,
  deleteFastLaneShadowRunHeartbeat: mocks.deleteHeartbeat,
  saveFastLaneShadowRunError: mocks.saveRunError,
}))

vi.mock('./repositories/fast-lane-storage-retention', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./repositories/fast-lane-storage-retention')
  >()

  return {
    ...actual,
    assertFastLaneStorageCapacity: mocks.assertCapacity,
    pruneFastLaneStorage: mocks.pruneStorage,
  }
})

function caughtUpDatabase(caughtUp = true): D1Database {
  return {
    prepare(sql: string) {
      return {
        async first<T>() {
          if (sql.includes('FROM fast_lane_shadow_state')) {
            return {
              last_processed_ledger: caughtUp ? 100 : 99,
              latest_observed_ledger: 100,
            } as T
          }

          throw new Error(`Unexpected SQL: ${sql}`)
        },
      }
    },
  } as unknown as D1Database
}

function environment(caughtUp = true): {
  env: Bindings
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn(async () => undefined)

  return {
    env: {
      DB: caughtUpDatabase(caughtUp),
      FAST_LANE_QUEUE: {
        send,
      },
    } as unknown as Bindings,
    send,
  }
}

function delivery(options: { id?: string; scheduledTime?: number } = {}): {
  message: Message<FastLaneQueueMessage>
  ack: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
} {
  const ack = vi.fn()
  const retry = vi.fn()
  const scheduledTime = options.scheduledTime ?? Date.parse('2026-07-30T14:00:00.000Z')

  return {
    message: {
      id: options.id ?? 'queue-message-1',
      timestamp: new Date('2026-07-30T14:00:00.000Z'),
      attempts: 1,
      body: {
        scheduledTime,
        cron: 'queue-self-schedule',
        enqueuedAt: '2026-07-30T14:00:00.000Z',
      },
      ack,
      retry,
    } as Message<FastLaneQueueMessage>,
    ack,
    retry,
  }
}

async function runQueue(
  message: Message<FastLaneQueueMessage>,
  env: Bindings,
): Promise<void> {
  if (!wrappedWorker.queue) {
    throw new Error('Queue handler is unavailable')
  }

  await wrappedWorker.queue(
    {
      messages: [message],
    } as MessageBatch<FastLaneQueueMessage>,
    env,
    {} as ExecutionContext,
  )
}

beforeEach(() => {
  vi.resetAllMocks()

  mocks.assertCapacity.mockResolvedValue(undefined)
  mocks.readSlot.mockResolvedValue(null)
  mocks.claimSlot.mockResolvedValue('claimed')
  mocks.completeSlot.mockResolvedValue(undefined)
  mocks.stageSuccessor.mockResolvedValue(undefined)
  mocks.markSlotError.mockResolvedValue(undefined)
  mocks.pruneSlots.mockResolvedValue(undefined)
  mocks.pruneStorage.mockResolvedValue(undefined)
  mocks.saveHeartbeat.mockResolvedValue(undefined)
  mocks.deleteHeartbeat.mockResolvedValue(undefined)
  mocks.saveRunError.mockResolvedValue(undefined)
  mocks.workerScheduled.mockResolvedValue(undefined)
  mocks.promoteCompact.mockResolvedValue(null)
  mocks.runCanonicalBridge.mockResolvedValue({
    bridgeReady: false,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('p0 heartbeat capacity halt', () => {
  it('executes exactly one pass even when the fast lane remains behind', async () => {
    const { env, send } = environment(false)
    const { message, ack } = delivery()

    await runQueue(message, env)

    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(mocks.completeSlot).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ cron: FAST_LANE_CATCH_UP_CRON }),
      expect.any(Object),
    )
    expect(ack).toHaveBeenCalledOnce()
  })

  it('durably stages the successor before sending and completes afterward', async () => {
    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

    expect(mocks.stageSuccessor).toHaveBeenCalledOnce()
    expect(mocks.completeSlot).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ cron: FAST_LANE_NORMAL_CRON }),
      expect.any(Object),
    )
    expect(mocks.stageSuccessor.mock.invocationCallOrder[0])
      .toBeLessThan(send.mock.invocationCallOrder[0])
    expect(send.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.completeSlot.mock.invocationCallOrder[0])
    expect(retry).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('acknowledges a completed duplicate without processing or scheduling', async () => {
    mocks.claimSlot.mockResolvedValueOnce('duplicate')
    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

    expect(mocks.workerScheduled).not.toHaveBeenCalled()
    expect(mocks.completeSlot).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('publishes a staged successor before a later delivery applies a capacity halt', async () => {
    const { env, send } = environment()
    const first = delivery()
    const nextScheduledTime = Date.parse('2026-07-30T14:05:00.000Z')
    const next = delivery({ id: 'queue-message-2', scheduledTime: nextScheduledTime })
    send.mockRejectedValueOnce(new Error('Queue send failed')).mockResolvedValueOnce(undefined)
    mocks.assertCapacity
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new FastLaneStorageCapacityError(
        'database_size',
        'physical database capacity guard reached on following slot',
      ))
    mocks.readSlot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'processing',
        messageId: first.message.id,
        nextScheduledTime,
        nextCron: FAST_LANE_NORMAL_CRON,
      })
      .mockResolvedValueOnce(null)

    await runQueue(first.message, env)

    expect(first.retry).toHaveBeenCalledOnce()
    expect(first.ack).not.toHaveBeenCalled()
    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(mocks.completeSlot).not.toHaveBeenCalled()

    await runQueue(first.message, env)

    expect(send).toHaveBeenCalledTimes(2)
    expect(mocks.assertCapacity).toHaveBeenCalledTimes(2)
    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(mocks.stageSuccessor).toHaveBeenCalledOnce()
    expect(mocks.completeSlot).toHaveBeenCalledOnce()
    expect(first.ack).toHaveBeenCalledOnce()

    await runQueue(next.message, env)

    expect(next.ack).toHaveBeenCalledOnce()
    expect(next.retry).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(2)
    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(mocks.claimSlot).toHaveBeenCalledOnce()
  })

  it('halts before slot claim and acknowledges a capacity-blocked delivery', async () => {
    const capacityError = new FastLaneStorageCapacityError(
      'database_size',
      'physical database capacity guard reached',
    )

    mocks.assertCapacity.mockRejectedValueOnce(capacityError)

    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

    expect(mocks.readSlot).toHaveBeenCalledOnce()
    expect(mocks.claimSlot).not.toHaveBeenCalled()
    expect(mocks.workerScheduled).not.toHaveBeenCalled()
    expect(mocks.markSlotError).toHaveBeenCalledWith(expect.objectContaining({
      scheduledTime: message.body.scheduledTime,
      messageId: message.id,
      errorMessage: capacityError.message,
    }))
    expect(send).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('does not schedule another message when the post-cycle guard halts', async () => {
    const capacityError = new FastLaneStorageCapacityError(
      'database_size',
      'physical database capacity guard reached after processing',
    )

    mocks.assertCapacity
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(capacityError)

    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

    expect(mocks.claimSlot).toHaveBeenCalledOnce()
    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    expect(mocks.completeSlot).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('retries an ordinary transient failure', async () => {
    mocks.assertCapacity.mockRejectedValueOnce(
      new Error('XRPL endpoint temporarily unavailable'),
    )

    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

    expect(mocks.claimSlot).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledWith({
      delaySeconds: FAST_LANE_QUEUE_RETRY_DELAY_SECONDS,
    })
  })

  it.each([
    {
      label: 'normal',
      cron: FAST_LANE_NORMAL_CRON,
      protectedCollectorRuns: true,
    },
    {
      label: 'catch-up',
      cron: FAST_LANE_CATCH_UP_CRON,
      protectedCollectorRuns: false,
    },
  ])('replays an exact staged $label successor after Queue publication fails', async ({
    cron,
    protectedCollectorRuns,
  }) => {
    const protectedBoundary = Date.parse('2026-07-31T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T11:59:59.000Z'))
    const { env, send } = environment(cron === FAST_LANE_NORMAL_CRON)
    const { message, ack, retry } = delivery()
    send.mockRejectedValueOnce(new Error('Queue send failed')).mockResolvedValueOnce(undefined)
    mocks.readSlot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'processing',
        messageId: message.id,
        nextScheduledTime: protectedBoundary,
        nextCron: cron,
      })

    await runQueue(message, env)
    expect(retry).toHaveBeenCalledWith({
      delaySeconds: FAST_LANE_QUEUE_RETRY_DELAY_SECONDS,
    })
    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(mocks.stageSuccessor).toHaveBeenCalledWith(expect.objectContaining({
      nextScheduledTime: protectedBoundary,
      nextCron: cron,
    }))

    await runQueue(message, env)

    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(mocks.stageSuccessor).toHaveBeenCalledOnce()
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scheduledTime: protectedBoundary,
        cron,
      }),
      expect.any(Object),
    )
    const recovered = send.mock.calls.at(-1)?.[0] as FastLaneQueueMessage
    expect(shouldRunProtectedHeavyCycle(recovered.scheduledTime, recovered.cron))
      .toBe(protectedCollectorRuns)
    expect(mocks.completeSlot).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('fails closed without publishing a successor on subrequest exhaustion', async () => {
    const exhaustion = new Error('Too many subrequests by single Worker invocation.')
    mocks.workerScheduled.mockRejectedValueOnce(exhaustion)

    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

    expect(mocks.markSlotError).toHaveBeenCalledWith(expect.objectContaining({
      scheduledTime: message.body.scheduledTime,
      messageId: message.id,
      errorMessage: exhaustion.message,
    }))
    expect(mocks.saveRunError).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: exhaustion.message,
    }))
    expect(mocks.stageSuccessor).not.toHaveBeenCalled()
    expect(mocks.completeSlot).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('retries a transient D1 failure with backoff and resumes the same slot exactly once', async () => {
    const transient = new Error('D1_ERROR: Network connection lost.')
    mocks.workerScheduled
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(undefined)

    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

    expect(retry).toHaveBeenCalledWith({
      delaySeconds: FAST_LANE_QUEUE_RETRY_DELAY_SECONDS,
    })
    expect(ack).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(mocks.stageSuccessor).not.toHaveBeenCalled()

    await runQueue(message, env)

    expect(mocks.workerScheduled).toHaveBeenCalledTimes(2)
    expect(mocks.stageSuccessor).toHaveBeenCalledOnce()
    expect(mocks.completeSlot).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledOnce()
  })

  it('does not enqueue from the fallback scheduler during a capacity halt', async () => {
    mocks.assertCapacity.mockRejectedValueOnce(
      new FastLaneStorageCapacityError(
        'database_size',
        'physical database capacity guard reached',
      ),
    )

    const { env, send } = environment()

    if (!wrappedWorker.scheduled) {
      throw new Error('Scheduled handler is unavailable')
    }

    await wrappedWorker.scheduled(
      {
        scheduledTime: Date.parse('2026-07-30T14:00:00.000Z'),
        cron: 'queue-self-schedule',
        noRetry: vi.fn(),
      } as ScheduledController,
      env,
      {} as ExecutionContext,
    )

    expect(send).not.toHaveBeenCalled()
  })
})
