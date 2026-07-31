import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings, FastLaneQueueMessage } from './env'
import schedulerWorker from './p0-redundant-scheduler-entry'
import { FastLaneStorageCapacityError } from './repositories/fast-lane-storage-retention'

const mocks = vi.hoisted(() => ({
  assertCapacity: vi.fn(),
  queue: vi.fn(),
}))

vi.mock('./p0-heartbeat-entry', () => ({
  default: {
    fetch: vi.fn(),
    queue: mocks.queue,
  },
}))

vi.mock('./repositories/fast-lane-storage-retention', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./repositories/fast-lane-storage-retention')
  >()

  return {
    ...actual,
    assertFastLaneStorageCapacity: mocks.assertCapacity,
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.assertCapacity.mockResolvedValue(undefined)
})

describe('p0 redundant scheduler capacity halt', () => {
  it('normalizes Cron seeds to the preceding five-minute boundary', async () => {
    const send = vi.fn(async () => undefined)
    const env = {
      DB: {} as D1Database,
      FAST_LANE_QUEUE: { send },
    } as unknown as Bindings

    if (!schedulerWorker.scheduled) throw new Error('Scheduled handler is unavailable')

    await schedulerWorker.scheduled(
      {
        scheduledTime: Date.parse('2026-07-31T16:18:12.000Z'),
        cron: '*/5 * * * *',
        noRetry: vi.fn(),
      } as ScheduledController,
      env,
      {} as ExecutionContext,
    )

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      scheduledTime: Date.parse('2026-07-31T16:15:00.000Z'),
      cron: '*/5 * * * *',
    }))
  })

  it('passes one-minute Queue successors through without changing delivery semantics', async () => {
    const body = {
      scheduledTime: Date.parse('2026-07-31T16:16:00.000Z'),
      cron: 'queue-self-schedule',
      enqueuedAt: '2026-07-31T16:15:30.000Z',
    }
    const ack = vi.fn()
    const retry = vi.fn()
    const message = {
      id: 'catch-up-16-16',
      timestamp: new Date('2026-07-31T16:15:30.000Z'),
      body,
      attempts: 1,
      ack,
      retry,
    }
    const batch = {
      queue: 'xrpl-lending-fast-lane',
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<FastLaneQueueMessage>
    const env = {} as Bindings
    const executionContext = {} as ExecutionContext
    mocks.queue.mockImplementationOnce((receivedBatch: MessageBatch<FastLaneQueueMessage>) => {
      const received = receivedBatch.messages[0]
      received.ack()
      received.retry({ delaySeconds: 60 })
    })

    if (!schedulerWorker.queue) throw new Error('Queue handler is unavailable')
    await schedulerWorker.queue(batch, env, executionContext)

    expect(mocks.queue).toHaveBeenCalledWith(batch, env, executionContext)
    expect(batch.messages[0]).toBe(message)
    expect(batch.messages[0]?.id).toBe('catch-up-16-16')
    expect(batch.messages[0]?.body).toBe(body)
    expect(body.scheduledTime).toBe(Date.parse('2026-07-31T16:16:00.000Z'))
    expect(ack).toHaveBeenCalledOnce()
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 })
  })

  it('does not reseed the Queue during a physical capacity halt', async () => {
    mocks.assertCapacity.mockRejectedValueOnce(
      new FastLaneStorageCapacityError(
        'database_size',
        'physical database capacity guard reached',
      ),
    )

    const send = vi.fn(async () => undefined)
    const env = {
      DB: {} as D1Database,
      FAST_LANE_QUEUE: {
        send,
      },
    } as unknown as Bindings

    if (!schedulerWorker.scheduled) {
      throw new Error('Scheduled handler is unavailable')
    }

    await schedulerWorker.scheduled(
      {
        scheduledTime: Date.parse('2026-07-30T14:03:12.000Z'),
        cron: '*/5 * * * *',
        noRetry: vi.fn(),
      } as ScheduledController,
      env,
      {} as ExecutionContext,
    )

    expect(mocks.assertCapacity).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })
})
