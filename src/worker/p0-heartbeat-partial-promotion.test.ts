import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Bindings, FastLaneQueueMessage } from './env'
import { FAST_LANE_CATCH_UP_CRON } from './fast-lane-successor-cadence'

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

function behindDatabase(): D1Database {
  return {
    prepare(sql: string) {
      return {
        async first<T>() {
          if (sql.includes('FROM fast_lane_shadow_state')) {
            return {
              last_processed_ledger: 99,
              latest_observed_ledger: 100,
            } as T
          }
          throw new Error(`Unexpected SQL: ${sql}`)
        },
      }
    },
  } as unknown as D1Database
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.assertCapacity.mockResolvedValue(undefined)
  mocks.claimSlot.mockResolvedValue('claimed')
  mocks.completeSlot.mockResolvedValue(undefined)
  mocks.readSlot.mockResolvedValue(null)
  mocks.stageSuccessor.mockResolvedValue(undefined)
  mocks.markSlotError.mockResolvedValue(undefined)
  mocks.pruneSlots.mockResolvedValue(undefined)
  mocks.pruneStorage.mockResolvedValue(undefined)
  mocks.saveHeartbeat.mockResolvedValue(undefined)
  mocks.deleteHeartbeat.mockResolvedValue(undefined)
  mocks.saveRunError.mockResolvedValue(undefined)
  mocks.workerScheduled.mockResolvedValue(undefined)
  mocks.promoteCompact.mockResolvedValue({
    promotedThroughLedger: 99,
    canonicalLedgerAfter: 99,
    rowsBefore: 1,
    rowsAfter: 0,
    promotedRows: 1,
  })
  mocks.runCanonicalBridge.mockResolvedValue({ bridgeReady: true })
})

describe('p0 heartbeat partial Current promotion', () => {
  it('promotes the newest committed compact state even while catch-up lag remains', async () => {
    const send = vi.fn(async () => undefined)
    const ack = vi.fn()
    const retry = vi.fn()
    const scheduledTime = Date.parse('2026-08-31T16:00:00.000Z')
    const env = {
      DB: behindDatabase(),
      FAST_LANE_QUEUE: { send },
    } as unknown as Bindings
    const message = {
      id: 'partial-promotion-message',
      timestamp: new Date('2026-08-31T16:00:00.000Z'),
      attempts: 1,
      body: {
        scheduledTime,
        cron: FAST_LANE_CATCH_UP_CRON,
        enqueuedAt: '2026-08-31T16:00:00.000Z',
      },
      ack,
      retry,
    } as Message<FastLaneQueueMessage>

    const module = await import('./p0-heartbeat-entry')
    if (!module.default.queue) throw new Error('Queue handler is unavailable')

    await module.default.queue(
      { messages: [message] } as MessageBatch<FastLaneQueueMessage>,
      env,
      {} as ExecutionContext,
    )

    expect(mocks.workerScheduled).toHaveBeenCalledOnce()
    expect(mocks.promoteCompact).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ cron: FAST_LANE_CATCH_UP_CRON }),
      expect.any(Object),
    )
    expect(retry).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledOnce()
  })
})
