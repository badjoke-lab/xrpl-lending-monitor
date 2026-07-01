import type {
  CanonicalAsset,
  IouAsset,
  MptAsset,
  XrpAsset,
} from './types'

const HEX_CURRENCY_PATTERN = /^[A-Fa-f0-9]{40}$/
const MPT_ISSUANCE_ID_PATTERN = /^[A-Fa-f0-9]{48}$/

export const XRP_ASSET: XrpAsset = {
  type: 'xrp',
  key: 'XRP',
  symbol: 'XRP',
  scale: 6,
}

export function normalizeCurrencyCode(input: string): string {
  const currency = input.trim()
  if (currency.length === 0) throw new Error('IOU currency is required')
  if (currency.includes(':')) throw new Error('IOU currency must not contain a colon')
  if (currency.toUpperCase() === 'XRP') {
    throw new Error('XRP cannot be represented as an issued currency')
  }

  if (HEX_CURRENCY_PATTERN.test(currency)) return currency.toUpperCase()
  if (currency.length === 3 && /^[\x21-\x7E]{3}$/.test(currency)) return currency

  throw new Error('IOU currency must be a 3-character code or 40 hexadecimal characters')
}

export function normalizeIssuer(input: string): string {
  const issuer = input.trim()
  if (issuer.length === 0) throw new Error('IOU issuer is required')
  if (/\s/.test(issuer) || issuer.includes(':')) {
    throw new Error('IOU issuer contains unsupported characters')
  }
  return issuer
}

export function normalizeMptIssuanceId(input: string): string {
  const issuanceId = input.trim()
  if (!MPT_ISSUANCE_ID_PATTERN.test(issuanceId)) {
    throw new Error('MPT issuance ID must contain exactly 48 hexadecimal characters')
  }
  return issuanceId.toUpperCase()
}

export function createIouAsset(currencyInput: string, issuerInput: string): IouAsset {
  const currency = normalizeCurrencyCode(currencyInput)
  const issuer = normalizeIssuer(issuerInput)

  return {
    type: 'iou',
    key: `IOU:${currency}:${issuer}`,
    currency,
    issuer,
    label: `${currency} · ${issuer}`,
    scale: null,
  }
}

export function createMptAsset(issuanceIdInput: string): MptAsset {
  const issuanceId = normalizeMptIssuanceId(issuanceIdInput)

  return {
    type: 'mpt',
    key: `MPT:${issuanceId}`,
    issuanceId,
    issuer: null,
    ticker: null,
    name: null,
    scale: 0,
    metadataSource: 'none',
    transferFeeTenthsBasisPoints: null,
    properties: null,
  }
}

export function sameAsset(left: CanonicalAsset, right: CanonicalAsset): boolean {
  return left.key === right.key
}

export function assertSameAsset(left: CanonicalAsset, right: CanonicalAsset): void {
  if (!sameAsset(left, right)) {
    throw new Error(`Cannot combine unlike assets: ${left.key} and ${right.key}`)
  }
}
