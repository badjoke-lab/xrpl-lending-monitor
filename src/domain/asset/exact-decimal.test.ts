import { describe, expect, it } from 'vitest'

import { ExactDecimal } from './exact-decimal'

describe('ExactDecimal', () => {
  it('parses plain and scientific decimal strings exactly', () => {
    expect(ExactDecimal.parse('001.2300').toString()).toBe('1.23')
    expect(ExactDecimal.parse('1.23e3').toString()).toBe('1230')
    expect(ExactDecimal.parse('1.23e-3').toString()).toBe('0.00123')
    expect(ExactDecimal.parse('-0.500').toString()).toBe('-0.5')
  })

  it('adds and subtracts values with different scales', () => {
    expect(
      ExactDecimal.parse('9999999999999999.999')
        .add(ExactDecimal.parse('0.001'))
        .toString(),
    ).toBe('10000000000000000')

    expect(
      ExactDecimal.parse('100').subtract(ExactDecimal.parse('0.000001')).toString(),
    ).toBe('99.999999')
  })

  it('multiplies by an integer without precision loss', () => {
    expect(ExactDecimal.parse('0.001').multiplyInteger(500).toString()).toBe('0.5')
  })

  it('compares values with different scales', () => {
    expect(ExactDecimal.parse('1').compare(ExactDecimal.parse('1.000'))).toBe(0)
    expect(ExactDecimal.parse('0.9').compare(ExactDecimal.parse('1'))).toBe(-1)
    expect(ExactDecimal.parse('1.1').compare(ExactDecimal.parse('1'))).toBe(1)
  })

  it('formats fixed fractional digits without changing the value', () => {
    expect(
      ExactDecimal.fromScaledInteger('123', 6).toString({ minimumFractionDigits: 6 }),
    ).toBe('0.000123')
    expect(
      ExactDecimal.parse('1.2').toString({ minimumFractionDigits: 6 }),
    ).toBe('1.200000')
  })

  it('rejects invalid values and unsafe scales', () => {
    expect(() => ExactDecimal.parse('NaN')).toThrow('Invalid decimal value')
    expect(() => ExactDecimal.parse('1e999999999999999999999')).toThrow(
      'outside the safe range',
    )
    expect(() => ExactDecimal.fromScaledInteger('1', -1)).toThrow(
      'Decimal scale must be a non-negative safe integer',
    )
  })
})
