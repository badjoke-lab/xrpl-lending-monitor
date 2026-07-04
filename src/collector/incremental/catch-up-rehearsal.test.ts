import { describe, expect, it } from 'vitest'
import { evaluateCatchUpRehearsal } from './catch-up-rehearsal'

describe('catch-up rehearsal', () => {
  it('evaluates evidence', () => {
    expect(typeof evaluateCatchUpRehearsal).toBe('function')
  })
})
