import { describe, expect, it } from 'vitest'

import {
  assertFastLaneStorageCapacity,
  FAST_LANE_DATABASE_STOP_BYTES,
} from './fast-lane-storage-retention'

interface Usage {
  row_count: number
  payload_bytes: number
}

function database(options: {
  databaseBytes: number
  compact?: Usage
  overlay?: Usage
}): D1Database {
  const compact = options.compact ?? { row_count: 0, payload_bytes: 0 }
  const overlay = options.overlay ?? { row_count: 0, payload_bytes: 0 }

  return {
    prepare(sql: string) {
      return {
        async run() {
          if (!sql.includes('size_probe')) {
            throw new Error(`Unexpected run SQL: ${sql}`)
          }
          return {
            meta: {
              size_after: options.databaseBytes,
            },
          }
        },
        async first<T>() {
          if (sql.includes('fast_lane_shadow_objects_compact')) {
            return compact as T
          }
          if (sql.includes('current_state_overlay_objects')) {
            return overlay as T
          }
          throw new Error(`Unexpected first SQL: ${sql}`)
        },
      }
    },
  } as unknown as D1Database
}

describe('fast-lane storage capacity', () => {
  it('accepts the recovered production-size range', async () => {
    await expect(assertFastLaneStorageCapacity(database({
      databaseBytes: 230_191_104,
      compact: { row_count: 0, payload_bytes: 0 },
      overlay: { row_count: 0, payload_bytes: 0 },
    }))).resolves.toBeUndefined()
  })

  it('stops at the physical database threshold', async () => {
    await expect(assertFastLaneStorageCapacity(database({
      databaseBytes: FAST_LANE_DATABASE_STOP_BYTES,
    }))).rejects.toMatchObject({
      name: 'FastLaneStorageCapacityError',
      reason: 'database_size',
    })
  })

  it('checks the canonical overlay on every full capacity check', async () => {
    await expect(assertFastLaneStorageCapacity(database({
      databaseBytes: 250_000_000,
      overlay: {
        row_count: 50_000,
        payload_bytes: 1,
      },
    }))).rejects.toMatchObject({
      name: 'FastLaneStorageCapacityError',
      reason: 'canonical_overlay',
    })
  })
})
