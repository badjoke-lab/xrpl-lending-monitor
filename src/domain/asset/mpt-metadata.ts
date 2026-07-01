import { createMptAsset } from './identity'
import type {
  MptAsset,
  MptIssuanceLedgerEntry,
  MptMetadataSource,
  MptProperties,
} from './types'

const MPT_FLAGS = {
  globallyLocked: 0x00000001,
  canLock: 0x00000002,
  requiresAuthorization: 0x00000004,
  canEscrow: 0x00000008,
  canTrade: 0x00000010,
  canTransfer: 0x00000020,
  canClawback: 0x00000040,
} as const

interface DecodedMetadata {
  source: MptMetadataSource
  ticker: string | null
  name: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function optionalInteger(value: unknown, field: string, maximum: number): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${field} must be an integer from 0 to ${maximum}`)
  }
  return Number(value)
}

function metadataString(
  metadata: Record<string, unknown>,
  longKey: string,
  compactKey: string,
): string | null {
  return optionalString(metadata[longKey]) ?? optionalString(metadata[compactKey])
}

function decodeMetadata(value: unknown): DecodedMetadata {
  if (value === undefined || value === null || value === '') {
    return { source: 'none', ticker: null, name: null }
  }

  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[A-Fa-f0-9]+$/.test(value)) {
    return { source: 'invalid', ticker: null, name: null }
  }

  try {
    const bytes = new Uint8Array(value.length / 2)
    for (let index = 0; index < value.length; index += 2) {
      bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
    }

    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const metadata: unknown = JSON.parse(decoded)
    if (!isRecord(metadata)) {
      return { source: 'invalid', ticker: null, name: null }
    }

    return {
      source: 'ledger',
      ticker: metadataString(metadata, 'ticker', 't'),
      name: metadataString(metadata, 'name', 'n'),
    }
  } catch {
    return { source: 'invalid', ticker: null, name: null }
  }
}

export function decodeMptProperties(flags: number): MptProperties {
  if (!Number.isSafeInteger(flags) || flags < 0 || flags > 0xffffffff) {
    throw new Error('MPT Flags must be an unsigned 32-bit integer')
  }

  return {
    globallyLocked: (flags & MPT_FLAGS.globallyLocked) !== 0,
    canLock: (flags & MPT_FLAGS.canLock) !== 0,
    requiresAuthorization: (flags & MPT_FLAGS.requiresAuthorization) !== 0,
    canEscrow: (flags & MPT_FLAGS.canEscrow) !== 0,
    canTrade: (flags & MPT_FLAGS.canTrade) !== 0,
    canTransfer: (flags & MPT_FLAGS.canTransfer) !== 0,
    canClawback: (flags & MPT_FLAGS.canClawback) !== 0,
  }
}

export function resolveMptAsset(
  issuanceId: string,
  entry?: MptIssuanceLedgerEntry | null,
): MptAsset {
  const base = createMptAsset(issuanceId)
  if (!entry) return base

  if (
    entry.LedgerEntryType !== undefined &&
    entry.LedgerEntryType !== 'MPTokenIssuance'
  ) {
    throw new Error('MPT metadata response is not an MPTokenIssuance ledger entry')
  }

  const flags = optionalInteger(entry.Flags, 'MPT Flags', 0xffffffff) ?? 0
  const scale = optionalInteger(entry.AssetScale, 'MPT AssetScale', 255) ?? 0
  const transferFee = optionalInteger(entry.TransferFee, 'MPT TransferFee', 50_000)
  const metadata = decodeMetadata(entry.MPTokenMetadata)

  return {
    ...base,
    issuer: optionalString(entry.Issuer),
    ticker: metadata.ticker,
    name: metadata.name,
    scale,
    metadataSource: metadata.source,
    transferFeeTenthsBasisPoints: transferFee,
    properties: decodeMptProperties(flags),
  }
}
