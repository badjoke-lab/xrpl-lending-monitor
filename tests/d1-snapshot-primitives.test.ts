import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../src/worker/repositories/d1-snapshot'

describe('D1 snapshot primitives', () => {
  it('canonicalizes keys', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })
})
