const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new Error('Decimal exponent must be a non-negative safe integer')
  }
  return 10n ** BigInt(exponent)
}

export class ExactDecimal {
  readonly coefficient: bigint
  readonly scale: number

  private constructor(coefficient: bigint, scale: number) {
    if (!Number.isSafeInteger(scale) || scale < 0) {
      throw new Error('Decimal scale must be a non-negative safe integer')
    }

    let normalizedCoefficient = coefficient
    let normalizedScale = scale
    while (
      normalizedScale > 0 &&
      normalizedCoefficient !== 0n &&
      normalizedCoefficient % 10n === 0n
    ) {
      normalizedCoefficient /= 10n
      normalizedScale -= 1
    }

    if (normalizedCoefficient === 0n) normalizedScale = 0

    this.coefficient = normalizedCoefficient
    this.scale = normalizedScale
  }

  static zero(): ExactDecimal {
    return new ExactDecimal(0n, 0)
  }

  static fromScaledInteger(value: string | bigint | number, scale: number): ExactDecimal {
    const coefficient =
      typeof value === 'bigint'
        ? value
        : typeof value === 'number'
          ? BigInt(value)
          : BigInt(value)

    return new ExactDecimal(coefficient, scale)
  }

  static parse(value: string): ExactDecimal {
    const trimmed = value.trim()
    const match = DECIMAL_PATTERN.exec(trimmed)
    if (!match) throw new Error(`Invalid decimal value: ${value}`)

    const sign = match[1] === '-' ? -1n : 1n
    const whole = match[2]
    const fraction = match[3] ?? ''
    const exponent = Number(match[4] ?? '0')
    if (!Number.isSafeInteger(exponent)) {
      throw new Error(`Decimal exponent is outside the safe range: ${value}`)
    }

    const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/u, '')
    let coefficient = sign * BigInt(digits)
    let scale = fraction.length - exponent

    if (scale < 0) {
      coefficient *= powerOfTen(-scale)
      scale = 0
    }

    return new ExactDecimal(coefficient, scale)
  }

  add(other: ExactDecimal): ExactDecimal {
    const targetScale = Math.max(this.scale, other.scale)
    const left = this.coefficient * powerOfTen(targetScale - this.scale)
    const right = other.coefficient * powerOfTen(targetScale - other.scale)
    return new ExactDecimal(left + right, targetScale)
  }

  subtract(other: ExactDecimal): ExactDecimal {
    return this.add(new ExactDecimal(-other.coefficient, other.scale))
  }

  multiplyInteger(multiplier: string | bigint | number): ExactDecimal {
    const value =
      typeof multiplier === 'bigint'
        ? multiplier
        : typeof multiplier === 'number'
          ? BigInt(multiplier)
          : BigInt(multiplier)
    return new ExactDecimal(this.coefficient * value, this.scale)
  }

  shiftDecimalLeft(places: number): ExactDecimal {
    if (!Number.isSafeInteger(places)) {
      throw new Error('Decimal shift must be a safe integer')
    }
    if (places >= 0) return new ExactDecimal(this.coefficient, this.scale + places)
    return new ExactDecimal(this.coefficient * powerOfTen(-places), this.scale)
  }

  compare(other: ExactDecimal): number {
    const targetScale = Math.max(this.scale, other.scale)
    const left = this.coefficient * powerOfTen(targetScale - this.scale)
    const right = other.coefficient * powerOfTen(targetScale - other.scale)
    return left < right ? -1 : left > right ? 1 : 0
  }

  isNegative(): boolean {
    return this.coefficient < 0n
  }

  isZero(): boolean {
    return this.coefficient === 0n
  }

  toString(options: { minimumFractionDigits?: number } = {}): string {
    const minimumFractionDigits = options.minimumFractionDigits ?? 0
    if (!Number.isSafeInteger(minimumFractionDigits) || minimumFractionDigits < 0) {
      throw new Error('minimumFractionDigits must be a non-negative safe integer')
    }

    const negative = this.coefficient < 0n
    const absolute = (negative ? -this.coefficient : this.coefficient).toString()
    const displayScale = Math.max(this.scale, minimumFractionDigits)
    const padded = absolute.padStart(this.scale + 1, '0')
    const whole = this.scale === 0 ? padded : padded.slice(0, -this.scale) || '0'
    const fraction = this.scale === 0 ? '' : padded.slice(-this.scale)
    const displayedFraction = fraction.padEnd(displayScale, '0')

    return `${negative ? '-' : ''}${whole}${displayScale > 0 ? `.${displayedFraction}` : ''}`
  }
}
