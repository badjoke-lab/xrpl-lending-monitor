import { describe, expect, it } from 'vitest'

import { getActiveSnapshot } from './core-api-repository'

function failingDatabase(error: Error): D1Database {
  return {
    prepare() {
      return {
        async first() {
          throw error
        },
      }
    },
  } as unknown as D1Database
}

describe('core API active snapshot repository', () => {
  it('treats the not-yet-applied D1 current-state schema as unavailable', async () => {
    const db = failingDatabase(new Error('D1_ERROR: no such table: current_state_d1_active_snapshots'))
    await expect(getActiveSnapshot(db)).resolves.toBeNull()
  })

  it('does not hide unrelated D1 failures', async () => {
    const db = failingDatabase(new Error('D1_ERROR: database is unavailable'))
    await expect(getActiveSnapshot(db)).rejects.toThrow('database is unavailable')
  })
})
