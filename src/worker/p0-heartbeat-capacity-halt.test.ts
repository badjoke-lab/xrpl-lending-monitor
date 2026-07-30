import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings, FastLaneQueueMessage } from './env'
import wrappedWorker from './p0-heartbeat-entry'
import { FastLaneStorageCapacityError } from './repositories/fast-lane-storage-retention'

const mocks = vi.hoisted(() => ({
  assertCapacity: vi.fn(),
  claimSlot: vi.fn(),
  completeSlot: vi.fn(),
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

function caughtUpDatabase(): D1Database {
  return {
    prepare(sql: string) {
      return {
        async first<T>() {
          if (sql.includes('FROM fast_lane_shadow_state')) {
            return {
              last_processed_ledger: 100,
              latest_observed_ledger: 100,
            } as T
          }

          throw new Error(`Unexpected SQL: ${sql}`)
        },
      }
    },
  } as unknown as D1Database
}

function environment(): {
  env: Bindings
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn(async () => undefined)

  return {
    env: {
      DB: caughtUpDatabase(),
      FAST_LANE_QUEUE: {
        send,
      },
    } as unknown as Bindings,
    send,
  }
}

function delivery(): {
  message: Message<FastLaneQueueMessage>
  ack: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
} {
  const ack = vi.fn()
  const retry = vi.fn()

  return {
    message: {
      id: 'queue-message-1',
      timestamp: new Date('2026-07-30T14:00:00.000Z'),
      attempts: 1,
      body: {
        scheduledTime: Date.parse('2026-07-30T14:00:00.000Z'),
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
  mocks.claimSlot.mockResolvedValue(true)
  mocks.completeSlot.mockResolvedValue(undefined)
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

describe('p0 heartbeat capacity halt', () => {
  it('halts before slot claim and acknowledges a capacity-blocked delivery', async () => {
    const capacityError = new FastLaneStorageCapacityError(
      'database_size',
      'physical database capacity guard reached',
    )

    mocks.assertCapacity.mockRejectedValueOnce(capacityError)

    const { env, send } = environment()
    const { message, ack, retry } = delivery()

    await runQueue(message, env)

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
    expect(retry).toHaveBeenCalledOnce()
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
