import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../current-state/canonical-json'
import { historySegmentJsonValue } from './json-safe'

describe('history segment JSON normalization', () => {
  it('converts undefined object fields and array entries to null', () => {
    const normalized = historySegmentJsonValue({
      beforeValue: undefined,
      nested: { afterValue: undefined },
      values: [1, undefined, 3],
    })

    expect(normalized).toEqual({
      beforeValue: null,
      nested: { afterValue: null },
      values: [1, null, 3],
    })
    expect(() => canonicalJson(normalized)).not.toThrow()
  })

  it('preserves explicit null and ordinary JSON values', () => {
    expect(historySegmentJsonValue({
      value: null,
      text: 'x',
      count: 2,
      flag: false,
    })).toEqual({
      value: null,
      text: 'x',
      count: 2,
      flag: false,
    })
  })
})
