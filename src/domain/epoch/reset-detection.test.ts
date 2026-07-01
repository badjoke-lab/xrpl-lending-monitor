import { describe, expect, it } from 'vitest'

import { detectReset } from './reset-detection'

describe('detectReset', () => {
  it('does not suspect a reset for the first observation', () => {
    expect(detectReset(null, { index: 100, hash: 'A' })).toMatchObject({
      suspected: false,
      reason: null,
    })
  })

  it('detects a ledger index rewind', () => {
    expect(
      detectReset(
        { index: 100, hash: 'A' },
        { index: 10, hash: 'B' },
      ),
    ).toMatchObject({
      suspected: true,
      reason: 'ledger_index_rewind',
    })
  })

  it('detects a changed hash at the same ledger index', () => {
    expect(
      detectReset(
        { index: 100, hash: 'A' },
        { index: 100, hash: 'B' },
      ),
    ).toMatchObject({
      suspected: true,
      reason: 'same_index_hash_changed',
    })
  })

  it('accepts a forward-moving validated ledger', () => {
    expect(
      detectReset(
        { index: 100, hash: 'A' },
        { index: 101, hash: 'B' },
      ),
    ).toMatchObject({
      suspected: false,
      reason: null,
    })
  })
})
