import { ExactDecimal } from './exact-decimal'

function unsignedInteger(value: number | string | bigint, field: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative safe integer`)
    }
    return BigInt(value)
  }

  const text = value.toString()
  if (!/^\d+$/u.test(text)) {
    throw new Error(`${field} must be a non-negative integer`)
  }
  return BigInt(text)
}

export function tenthBasisPointsToPercent(
  value: number | string | bigint,
): ExactDecimal {
  return ExactDecimal.fromScaledInteger(unsignedInteger(value, 'Rate'), 3)
}

export function tenthBasisPointsToRatio(
  value: number | string | bigint,
): ExactDecimal {
  return ExactDecimal.fromScaledInteger(unsignedInteger(value, 'Rate'), 5)
}

export function formatTenthBasisPointRate(value: number | string | bigint): string {
  return `${tenthBasisPointsToPercent(value).toString()}%`
}
