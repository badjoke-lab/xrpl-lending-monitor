import { describe, expect, it } from 'vitest'

import { summarizePersistenceBatch } from './measured-incremental-commit'

describe('incremental persistence D1 usage', () => {
  it('sums rows read and written across D1 batch results', () => {
    expect(summarizePersistenceBatch({
      statements: 4,
      results: [
        { meta: { rows_read: 3, rows_written: 2 } },
        { meta: { rows_read: 5, rows_written: 7 } },
      ],
    })).toEqual({
      batchResults: 2,
      statements: 4,
      rowsRead: 8,
      rowsWritten: 9,
    })
  })

  it('treats absent or invalid metadata as zero without inventing usage', () => {
    expect(summarizePersistenceBatch({
      statements: 2,
      results: [
        {},
        { meta: { rows_read: -1, rows_written: '4' } },
      ],
    })).toEqual({
      batchResults: 2,
      statements: 2,
      rowsRead: 0,
      rowsWritten: 0,
    })
  })
})
