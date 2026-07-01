import { decodeMptMetadata } from './mpt-metadata'
import type { IouAsset, MptAsset, NormalizedAsset, XrpAsset } from './types'

const MPT_ID_PATTERN = /^[0-9A-Fa-f]{48}$/u
const HEX_CURRENCY_PATTERN = /^[0-9A-Fa-f]{40}$/u

interface AssetObject {
  currency?: unknown
  issuer?: unknown
  mpt_issuance_id?: unknown
}

export interface MptIssuanceLedgerObject {
  LedgerEntryType?: unknown
  Issuer?: unknown
  AssetScale?: unknown
  Flags?: unknown
  TransferFee?: unknown
  MPTokenMetadata?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeCurrency(currency: string): string {
  const trimmed = currency.trim()
  if (trimmed.length === 0) throw new Error('IOU currency must not be empty')
  return HEX_CURRENCY_PATTERN.test(trimmed) ? trimmed.toUpperCase() : trimmed
}

function normalizeMptId(value: string): string {
  const trimmed = value.trim()
  if (!MPT_ID_PATTERN.test(trimmed)) {
    throw new Error('MPT issuance ID must be 48 hexadecimal characters')
  }
  return trimmed.toUpperCase()
}

function shorten(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

export function xrpAsset(): XrpAsset {
  return {
    type: 'xrp',
    key: 'XRP',
    label: 'XRP',
  }
}

export function iouAsset(currency: string, issuer: string): IouAsset {
  const normalizedCurrency = normalizeCurrency(currency)
  const normalizedIssuer = issuer.trim()
  if (normalizedCurrency.toUpperCase() === 'XRP') {
    throw new Error('XRP cannot have an issuer')
  }
  if (normalizedIssuer.length === 0) {
    throw new Error('IOU issuer must not be empty')
  }

  return {
    type: 'iou',
    key: `IOU:${normalizedCurrency}:${normalizedIssuer}`,
    label: `${normalizedCurrency} · ${shorten(normalizedIssuer)}`,
    currency: normalizedCurrency,
    issuer: normalizedIssuer,
  }
}

export function unresolvedMptAsset(issuanceId: string): MptAsset {
  const normalizedId = normalizeMptId(issuanceId)
  return {
    type: 'mpt',
    key: `MPT:${normalizedId}`,
    label: `MPT ${shorten(normalizedId)}`,
    issuanceId: normalizedId,
    issuer: null,
    scale: null,
    flags: null,
    transferFee: null,
    metadataHex: null,
    metadata: null,
    metadataSource: 'none',
  }
}

export function normalizeAssetDescriptor(input: unknown): NormalizedAsset {
  if (input === 'XRP') return xrpAsset()
  if (!isRecord(input)) throw new Error('Asset descriptor must be an object or XRP')

  const descriptor = input as AssetObject
  if (typeof descriptor.mpt_issuance_id === 'string') {
    if (descriptor.currency !== undefined || descriptor.issuer !== undefined) {
      throw new Error('MPT asset descriptor cannot include currency or issuer')
    }
    return unresolvedMptAsset(descriptor.mpt_issuance_id)
  }

  if (typeof descriptor.currency !== 'string') {
    throw new Error('Asset descriptor must include currency or mpt_issuance_id')
  }

  if (descriptor.currency.toUpperCase() === 'XRP') {
    if (descriptor.issuer !== undefined) throw new Error('XRP asset descriptor cannot include issuer')
    return xrpAsset()
  }

  if (typeof descriptor.issuer !== 'string') {
    throw new Error('IOU asset descriptor must include issuer')
  }

  return iouAsset(descriptor.currency, descriptor.issuer)
}

function optionalSafeInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return null
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return Number(value)
}

export function resolveMptAsset(
  issuanceId: string,
  ledgerObject: MptIssuanceLedgerObject,
): MptAsset {
  const base = unresolvedMptAsset(issuanceId)
  if (
    ledgerObject.LedgerEntryType !== undefined &&
    ledgerObject.LedgerEntryType !== 'MPTokenIssuance'
  ) {
    throw new Error('Expected an MPTokenIssuance ledger object')
  }

  const issuer = ledgerObject.Issuer
  if (typeof issuer !== 'string' || issuer.length === 0) {
    throw new Error('MPTokenIssuance Issuer must be a non-empty string')
  }

  const scale = optionalSafeInteger(ledgerObject.AssetScale, 'AssetScale', 0, 255)
  const flags = optionalSafeInteger(ledgerObject.Flags, 'Flags', 0, 0xffffffff)
  const transferFee = optionalSafeInteger(ledgerObject.TransferFee, 'TransferFee', 0, 50000)
  const metadataHex =
    typeof ledgerObject.MPTokenMetadata === 'string' && ledgerObject.MPTokenMetadata.length > 0
      ? ledgerObject.MPTokenMetadata.toUpperCase()
      : null
  const decoded = metadataHex ? decodeMptMetadata(metadataHex) : null
  const ticker = decoded?.metadata?.ticker

  return {
    ...base,
    label: ticker ?? base.label,
    issuer,
    scale,
    flags,
    transferFee,
    metadataHex,
    metadata: decoded?.metadata ?? null,
    metadataSource: metadataHex ? 'ledger' : 'none',
  }
}

export function sameAsset(left: NormalizedAsset, right: NormalizedAsset): boolean {
  return left.key === right.key
}
