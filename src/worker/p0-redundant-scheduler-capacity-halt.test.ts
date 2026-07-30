import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings } from './env'
import schedulerWorker from './p0-redundant-scheduler-entry'
import { FastLaneStorageCapacityError } from './repositories/fast-lane-storage-retention'

const mocks = vi.hoisted(() => ({
  assertCapacity: vi.fn(),
}))

vi.mock('./p0-heartbeat-entry', () => ({
  default: {
    fetch: vi.fn(),
    queue: vi.fn(),
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
