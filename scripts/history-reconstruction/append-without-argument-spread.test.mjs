import { describe, expect, it } from 'vitest'

import { appendWithoutArgumentSpread } from './append-without-argument-spread.mjs'

describe('appendWithoutArgumentSpread', () => {
  it('appends 200,000 entries without expanding them as function arguments', () => {
    const target = []
    const values = Array.from({ length: 200_000 }, (_, index) => index)

    appendWithoutArgumentSpread(target, values)

    expect(target).toHaveLength(values.length)
    expect(target[0]).toBe(0)
    expect(target.at(-1)).toBe(199_999)
  })
})
