export interface ExactDecimal {
  coefficient: string
  scale: number
}

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/
const INTEGER_PATTERN = /^-?\d+$/
const UNSIGNED_INTEGER_PATTERN = /^\d+$/

function normalizeCoefficient(value: bigint, scale: number): ExactDecimal {
  if (value === 0n) return { coefficient: '0', scale: 0 }

  let coefficient = value
  let normalizedScale = scale

  while (normalizedScale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    normalizedScale -= 1
  }

  return {
    coefficient: coefficient.toString(),
    scale: normalizedScale,
  }
}

export function parseExactDecimal(input: string): ExactDecimal {
  const value = input.trim()
  const match = DECIMAL_PATTERN.exec(value)
  if (!match) throw new Error(`Invalid decimal value: ${input}`)

  const sign = match[1] === '-' ? -1n : 1n
  const integer = match[2]
  const fraction = match[3] ?? ''
  const exponent = Number(match[4] ?? '0')

  if (!Number.isSafeInteger(exponent)) {
    throw new Error(`Decimal exponent is outside the supported range: ${input}`)
  }

  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '')
  let coefficient = BigInt(digits || '0') * sign
  let scale = fraction.length - exponent

  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    scale = 0
  }

  if (scale > 1_000) {
    throw new Error(`Decimal scale is outside the supported range: ${input}`)
  }

  return normalizeCoefficient(coefficient, scale)
}

export function parseInteger(input: string): bigint {
  const value = input.trim()
  if (!INTEGER_PATTERN.test(value)) throw new Error(`Invalid integer value: ${input}`)
  return BigInt(value)
}

export function parseUnsignedInteger(input: string): bigint {
  const value = input.trim()
  if (!UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw new Error(`Invalid unsigned integer value: ${input}`)
  }
  return BigInt(value)
}

export function decimalFromScaledInteger(input: string, scale: number): ExactDecimal {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 255) {
    throw new Error('Scale must be an integer from 0 to 255')
  }

  return normalizeCoefficient(parseInteger(input), scale)
}

export function formatExactDecimal(value: ExactDecimal, minimumScale = 0): string {
  if (!Number.isSafeInteger(value.scale) || value.scale < 0) {
    throw new Error('Decimal scale must be a non-negative integer')
  }
  if (!Number.isSafeInteger(minimumScale) || minimumScale < 0) {
    throw new Error('Minimum scale must be a non-negative integer')
  }

  const coefficient = parseInteger(value.coefficient)
  const negative = coefficient < 0n
  const digits = (negative ? -coefficient : coefficient).toString()
  const scale = Math.max(value.scale, minimumScale)
  const padded = digits.padStart(value.scale + 1, '0')
  const whole = value.scale === 0 ? padded : padded.slice(0, -value.scale)
  const fraction = value.scale === 0 ? '' : padded.slice(-value.scale)
  const extendedFraction = fraction.padEnd(scale, '0')
  const sign = negative ? '-' : ''

  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${extendedFraction}`
}

function coefficientAtScale(value: ExactDecimal, scale: number): bigint {
  const coefficient = parseInteger(value.coefficient)
  return coefficient * 10n ** BigInt(scale - value.scale)
}

export function addExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale)
  return normalizeCoefficient(
    coefficientAtScale(left, scale) + coefficientAtScale(right, scale),
    scale,
  )
}

export function subtractExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale)
  return normalizeCoefficient(
    coefficientAtScale(left, scale) - coefficientAtScale(right, scale),
    scale,
  )
}

export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const scale = Math.max(left.scale, right.scale)
  const difference = coefficientAtScale(left, scale) - coefficientAtScale(right, scale)
  if (difference < 0n) return -1
  if (difference > 0n) return 1
  return 0
}

export function multiplyExactDecimalByInteger(
  value: ExactDecimal,
  multiplier: bigint,
): ExactDecimal {
  return normalizeCoefficient(parseInteger(value.coefficient) * multiplier, value.scale)
}
