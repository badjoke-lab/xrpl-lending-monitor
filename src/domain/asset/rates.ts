import { decimalFromScaledInteger, formatExactDecimal } from './decimal'

export interface NormalizedRate {
  rawTenthsBasisPoints: number
  basisPoints: string
  percent: string
  fraction: string
}

export function normalizeTenthsBasisPointRate(
  value: number,
  upperBound = 100_000,
): NormalizedRate {
  if (!Number.isSafeInteger(upperBound) || upperBound < 0) {
    throw new Error('Rate upper bound must be a non-negative integer')
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > upperBound) {
    throw new Error(`Rate must be an integer from 0 to ${upperBound}`)
  }

  const raw = String(value)
  return {
    rawTenthsBasisPoints: value,
    basisPoints: formatExactDecimal(decimalFromScaledInteger(raw, 1), 1),
    percent: formatExactDecimal(decimalFromScaledInteger(raw, 3), 3),
    fraction: formatExactDecimal(decimalFromScaledInteger(raw, 5), 5),
  }
}
