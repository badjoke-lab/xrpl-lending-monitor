import {
  addExactDecimals,
  decimalFromScaledInteger,
  formatExactDecimal,
  parseExactDecimal,
  parseUnsignedInteger,
} from './decimal'
import {
  assertSameAsset,
  createIouAsset,
  createMptAsset,
  normalizeMptIssuanceId,
  XRP_ASSET,
} from './identity'
import type {
  CanonicalAmount,
  CanonicalAsset,
  MptAsset,
  XrplAmount,
  XrplIssuedCurrencyAmount,
  XrplMptAmount,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIssuedCurrencyAmount(value: unknown): value is XrplIssuedCurrencyAmount {
  return (
    isRecord(value) &&
    typeof value.currency === 'string' &&
    typeof value.issuer === 'string' &&
    typeof value.value === 'string'
  )
}

function isMptAmount(value: unknown): value is XrplMptAmount {
  return (
    isRecord(value) &&
    typeof value.mpt_issuance_id === 'string' &&
    typeof value.value === 'string'
  )
}

function displayForAsset(asset: CanonicalAsset, raw: string): CanonicalAmount['value'] {
  if (asset.type === 'xrp') return decimalFromScaledInteger(raw, asset.scale)
  if (asset.type === 'mpt') return decimalFromScaledInteger(raw, asset.scale)
  return parseExactDecimal(raw)
}

function formatForAsset(asset: CanonicalAsset, value: CanonicalAmount['value']): string {
  if (asset.type === 'xrp' || asset.type === 'mpt') {
    return formatExactDecimal(value, asset.scale)
  }
  return formatExactDecimal(value)
}

function selectedMptAsset(issuanceId: string, resolved?: MptAsset): MptAsset {
  const normalizedId = normalizeMptIssuanceId(issuanceId)
  if (!resolved) return createMptAsset(normalizedId)
  if (resolved.issuanceId !== normalizedId) {
    throw new Error(
      `Resolved MPT ${resolved.issuanceId} does not match amount ${normalizedId}`,
    )
  }
  return resolved
}

export function normalizeXrplAmount(
  input: XrplAmount,
  options: { mptAsset?: MptAsset } = {},
): CanonicalAmount {
  if (typeof input === 'string') {
    const raw = input.trim()
    parseUnsignedInteger(raw)
    const value = displayForAsset(XRP_ASSET, raw)
    return {
      asset: XRP_ASSET,
      raw,
      value,
      display: formatForAsset(XRP_ASSET, value),
      provenance: 'direct',
    }
  }

  if (isIssuedCurrencyAmount(input)) {
    const asset = createIouAsset(input.currency, input.issuer)
    const raw = input.value.trim()
    const value = displayForAsset(asset, raw)
    return {
      asset,
      raw,
      value,
      display: formatForAsset(asset, value),
      provenance: 'direct',
    }
  }

  if (isMptAmount(input)) {
    const asset = selectedMptAsset(input.mpt_issuance_id, options.mptAsset)
    const raw = input.value.trim()
    parseUnsignedInteger(raw)
    const value = displayForAsset(asset, raw)
    return {
      asset,
      raw,
      value,
      display: formatForAsset(asset, value),
      provenance: 'direct',
    }
  }

  throw new Error('Unsupported XRPL amount shape')
}

export function normalizeXrplAsset(input: unknown, resolvedMpt?: MptAsset): CanonicalAsset {
  if (!isRecord(input)) throw new Error('Unsupported XRPL asset shape')

  if (input.currency === 'XRP' && input.issuer === undefined) return XRP_ASSET

  if (typeof input.currency === 'string' && typeof input.issuer === 'string') {
    return createIouAsset(input.currency, input.issuer)
  }

  if (typeof input.mpt_issuance_id === 'string') {
    return selectedMptAsset(input.mpt_issuance_id, resolvedMpt)
  }

  throw new Error('Unsupported XRPL asset shape')
}

export function addCanonicalAmounts(
  left: CanonicalAmount,
  right: CanonicalAmount,
): CanonicalAmount {
  assertSameAsset(left.asset, right.asset)
  const asset = left.asset

  if (asset.type === 'xrp' || asset.type === 'mpt') {
    const raw = (parseUnsignedInteger(left.raw) + parseUnsignedInteger(right.raw)).toString()
    const value = displayForAsset(asset, raw)
    return {
      asset,
      raw,
      value,
      display: formatForAsset(asset, value),
      provenance: 'derived',
    }
  }

  const value = addExactDecimals(left.value, right.value)
  const raw = formatExactDecimal(value)
  return {
    asset,
    raw,
    value,
    display: raw,
    provenance: 'derived',
  }
}
