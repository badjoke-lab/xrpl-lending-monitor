import { describe, expect, it } from 'vitest'

import { normalizeGa4MeasurementId } from './analytics'

describe('normalizeGa4MeasurementId', () => {
  it('accepts and normalizes configured GA4 measurement IDs', () => {
    expect(normalizeGa4MeasurementId(' g-ab12cd34 ')).toBe('G-AB12CD34')
  })

  it('keeps analytics disabled for missing or placeholder-like invalid values', () => {
    expect(normalizeGa4MeasurementId(undefined)).toBeNull()
    expect(normalizeGa4MeasurementId('')).toBeNull()
    expect(normalizeGa4MeasurementId('UA-123456-1')).toBeNull()
    expect(normalizeGa4MeasurementId('G-ABC DEF')).toBeNull()
  })
})
