import type { MptMetadata, MptMetadataUri } from './types'

const MAX_METADATA_BYTES = 1024
const HEX_PATTERN = /^(?:[0-9A-Fa-f]{2})+$/u
const TICKER_PATTERN = /^[A-Z0-9]{1,6}$/u
const ASSET_CLASSES = new Set(['rwa', 'memes', 'wrapped', 'gaming', 'defi', 'other'])
const RWA_SUBCLASSES = new Set([
  'stablecoin',
  'commodity',
  'real_estate',
  'private_credit',
  'equity',
  'treasury',
  'other',
])

const FIELD_ALIASES = {
  ticker: 't',
  name: 'n',
  desc: 'd',
  icon: 'i',
  asset_class: 'ac',
  asset_subclass: 'as',
  issuer_name: 'in',
  uris: 'us',
  additional_info: 'ai',
} as const

const URI_ALIASES = {
  uri: 'u',
  category: 'c',
  title: 't',
} as const

export interface MptMetadataDecodeResult {
  metadata: MptMetadata | null
  warnings: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAliasedValue(
  source: Record<string, unknown>,
  longName: keyof typeof FIELD_ALIASES,
  warnings: string[],
): unknown {
  const compactName = FIELD_ALIASES[longName]
  if (source[longName] !== undefined && source[compactName] !== undefined) {
    warnings.push(`${longName}/${compactName}: both long and compact fields are present`)
  }
  return source[longName] ?? source[compactName]
}

function readString(
  source: Record<string, unknown>,
  field: keyof typeof FIELD_ALIASES,
  warnings: string[],
  required: boolean,
): string | null {
  const value = readAliasedValue(source, field, warnings)
  if (value === undefined) {
    if (required) warnings.push(`${field}: required field is missing`)
    return null
  }
  if (typeof value !== 'string' || value.length === 0) {
    warnings.push(`${field}: expected a non-empty string`)
    return null
  }
  return value
}

function readUriField(
  source: Record<string, unknown>,
  field: keyof typeof URI_ALIASES,
  warnings: string[],
  index: number,
): string | null {
  const compact = URI_ALIASES[field]
  if (source[field] !== undefined && source[compact] !== undefined) {
    warnings.push(`uris[${index}].${field}/${compact}: both forms are present`)
  }
  const value = source[field] ?? source[compact]
  if (typeof value !== 'string' || value.length === 0) {
    warnings.push(`uris[${index}].${field}: expected a non-empty string`)
    return null
  }
  return value
}

function parseUris(value: unknown, warnings: string[]): MptMetadataUri[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length === 0) {
    warnings.push('uris: expected a non-empty array')
    return []
  }

  const uris: MptMetadataUri[] = []
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      warnings.push(`uris[${index}]: expected an object`)
      return
    }

    const uri = readUriField(item, 'uri', warnings, index)
    const category = readUriField(item, 'category', warnings, index)
    const title = readUriField(item, 'title', warnings, index)
    if (uri && category && title) uris.push({ uri, category, title })
  })

  return uris
}

function hexToUtf8(input: string): string {
  const bytes = new Uint8Array(input.length / 2)
  for (let index = 0; index < input.length; index += 2) {
    bytes[index / 2] = Number.parseInt(input.slice(index, index + 2), 16)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function decodeMptMetadata(input: string): MptMetadataDecodeResult {
  const warnings: string[] = []

  if (!HEX_PATTERN.test(input)) {
    return {
      metadata: null,
      warnings: ['MPTokenMetadata must be a non-empty even-length hexadecimal string'],
    }
  }

  if (input.length / 2 > MAX_METADATA_BYTES) {
    return {
      metadata: null,
      warnings: [`MPTokenMetadata exceeds ${MAX_METADATA_BYTES} bytes`],
    }
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(hexToUtf8(input))
  } catch (error) {
    return {
      metadata: null,
      warnings: [
        `MPTokenMetadata is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }

  if (!isRecord(decoded)) {
    return {
      metadata: null,
      warnings: ['MPTokenMetadata JSON must be an object'],
    }
  }

  const ticker = readString(decoded, 'ticker', warnings, true)
  const name = readString(decoded, 'name', warnings, true)
  const description = readString(decoded, 'desc', warnings, false)
  const icon = readString(decoded, 'icon', warnings, true)
  const assetClass = readString(decoded, 'asset_class', warnings, true)
  const assetSubclass = readString(decoded, 'asset_subclass', warnings, false)
  const issuerName = readString(decoded, 'issuer_name', warnings, true)
  const uris = parseUris(readAliasedValue(decoded, 'uris', warnings), warnings)
  const additionalInfo = readAliasedValue(decoded, 'additional_info', warnings)

  if (ticker && !TICKER_PATTERN.test(ticker)) {
    warnings.push('ticker: expected 1-6 uppercase letters or digits')
  }
  if (assetClass && !ASSET_CLASSES.has(assetClass)) {
    warnings.push(`asset_class: unsupported value ${assetClass}`)
  }
  if (assetClass === 'rwa' && !assetSubclass) {
    warnings.push('asset_subclass: required when asset_class is rwa')
  }
  if (assetSubclass && !RWA_SUBCLASSES.has(assetSubclass)) {
    warnings.push(`asset_subclass: unsupported value ${assetSubclass}`)
  }
  if (
    additionalInfo !== undefined &&
    typeof additionalInfo !== 'string' &&
    !isRecord(additionalInfo)
  ) {
    warnings.push('additional_info: expected a string or JSON object')
  }

  return {
    metadata: {
      ticker,
      name,
      description,
      icon,
      assetClass,
      assetSubclass,
      issuerName,
      uris,
      additionalInfo: additionalInfo ?? null,
      compliant: warnings.length === 0,
      warnings,
    },
    warnings,
  }
}
