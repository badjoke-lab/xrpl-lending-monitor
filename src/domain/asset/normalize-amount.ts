import { ExactDecimal } from './exact-decimal'
import { sameAsset } from './normalize-asset'
import type { NormalizedAmount, NormalizedAsset } from './types'

interface IouAmountObject {
  currency?: unknown
  issuer?: unknown
  value?: unknown
}

interface MptAmountObject {
  mpt_issuance_id?: unknown
  value?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rawForAsset(input: unknown, asset: NormalizedAsset): string {
  if (typeof input === 'string') return input
  if (!isRecord(input)) throw new Error('Amount must be a string or an amount object')

  if (asset.type === 'xrp') {
    throw new Error('XRP amounts must be strings denominated in drops')
  }

  if (asset.type === 'iou') {
    const amount = input as IouAmountObject
    if (
      amount.currency !== asset.currency ||
      amount.issuer !== asset.issuer ||
      typeof amount.value !== 'string'
    ) {
      throw new Error('IOU amount does not match the expected currency and issuer')
    }
    return amount.value
  }

  const amount = input as MptAmountObject
  if (
    typeof amount.mpt_issuance_id !== 'string' ||
    amount.mpt_issuance_id.toUpperCase() !== asset.issuanceId ||
    typeof amount.value !== 'string'
  ) {
    throw new Error('MPT amount does not match the expected issuance ID')
  }
  if (!/^\d+$/u.test(amount.value)) {
    throw new Error('MPT amount objects must use a non-negative integer value')
  }
  return amount.value
}

function displayValue(value: ExactDecimal, asset: NormalizedAsset): string {
  if (asset.type === 'xrp') {
    return value.shiftDecimalLeft(6).toString({ minimumFractionDigits: 6 })
  }

  if (asset.type === 'mpt' && asset.scale !== null) {
    return value
      .shiftDecimalLeft(asset.scale)
      .toString({ minimumFractionDigits: asset.scale })
  }

  return value.toString()
}

export function normalizeAmount(
  input: unknown,
  asset: NormalizedAsset,
): NormalizedAmount {
  const raw = rawForAsset(input, asset).trim()
  const value = ExactDecimal.parse(raw)

  if (asset.type === 'xrp' && (!/^\d+$/u.test(raw) || value.isNegative())) {
    throw new Error('XRP amount must be a non-negative integer number of drops')
  }

  return {
    asset,
    raw,
    canonical: value.toString(),
    display: displayValue(value, asset),
    provenance: 'direct',
  }
}

export function sumAmounts(amounts: readonly NormalizedAmount[]): NormalizedAmount {
  if (amounts.length === 0) throw new Error('At least one amount is required')

  const asset = amounts[0].asset
  let total = ExactDecimal.zero()
  for (const amount of amounts) {
    if (!sameAsset(asset, amount.asset)) {
      throw new Error(`Cannot aggregate unlike assets: ${asset.key} and ${amount.asset.key}`)
    }
    total = total.add(ExactDecimal.parse(amount.canonical))
  }

  return {
    asset,
    raw: total.toString(),
    canonical: total.toString(),
    display: displayValue(total, asset),
    provenance: 'derived',
  }
}
