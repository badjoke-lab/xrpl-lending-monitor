import type {
  PortableReaderSourceV1,
  PortableReadFenceV1,
} from './portable-collector-committed-reader'
import { PortableCommittedReaderError } from './portable-collector-committed-reader'
import {
  PortableProductMappingError,
  type PortableProductRecordV1,
} from './portable-collector-product-mappers'
import { canonicalPortableJson } from './portable-collector-reference-store'

export type PortableReaderCompatibilityMode = 'legacy_only' | 'shadow_compare'

export interface LegacyReaderAuthorityV1 {
  schemaVersion: 1
  mode: 'legacy'
  sourceId: string
}

export interface PortableShadowSnapshotV1 {
  schemaVersion: 1
  source: PortableReaderSourceV1
  fence: PortableReadFenceV1
  records: PortableProductRecordV1[]
}

export interface PortableShadowEvidenceV1 {
  schemaVersion: 1
  mode: 'shadow_compare'
  status: 'match' | 'mismatch' | 'portable_error' | 'skipped_limit'
  legacySourceId: string
  portableSourceId: string | null
  fence: PortableReadFenceV1 | null
  legacyCount: number
  portableCount: number | null
  legacyDigest: string
  portableDigest: string | null
  firstMismatchIndex: number | null
  errorCode: string | null
  errorMessage: string | null
}

export interface LegacyAuthoritativeReadResultV1<T> {
  schemaVersion: 1
  authority: LegacyReaderAuthorityV1
  response: T
  shadowEvidence: PortableShadowEvidenceV1 | null
}

export class PortableShadowCompatibilityError extends Error {
  constructor(
    readonly code: 'invalid_configuration' | 'legacy_normalization_failure',
    message: string,
  ) {
    super(message)
    this.name = 'PortableShadowCompatibilityError'
  }
}

function requireString(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new PortableShadowCompatibilityError(
      'invalid_configuration',
      `${name} is required`,
    )
  }
  return normalized
}

function requireLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new PortableShadowCompatibilityError(
      'invalid_configuration',
      'maxRecords must be between 1 and 1000',
    )
  }
  return value
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function digestCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPortableJson(value))
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', input)),
  )
}

function firstMismatch(left: readonly unknown[], right: readonly unknown[]): number | null {
  const maximum = Math.max(left.length, right.length)
  for (let index = 0; index < maximum; index += 1) {
    if (canonicalPortableJson(left[index]) !== canonicalPortableJson(right[index])) {
      return index
    }
  }
  return null
}

function classifyPortableError(error: unknown): { code: string; message: string } {
  if (error instanceof PortableCommittedReaderError) {
    return { code: `reader:${error.code}`, message: error.message }
  }
  if (error instanceof PortableProductMappingError) {
    return { code: `mapper:${error.code}`, message: error.message }
  }
  return {
    code: 'portable:unknown',
    message: error instanceof Error ? error.message : String(error),
  }
}

export async function executeLegacyAuthoritativeRead<T>(options: {
  mode: PortableReaderCompatibilityMode
  legacySourceId: string
  legacyRead: () => Promise<T>
  normalizeLegacy: (response: T) => unknown[]
  portableRead?: () => Promise<PortableShadowSnapshotV1>
  maxRecords: number
}): Promise<LegacyAuthoritativeReadResultV1<T>> {
  const legacySourceId = requireString(options.legacySourceId, 'legacySourceId')
  const maxRecords = requireLimit(options.maxRecords)
  if (options.mode === 'shadow_compare' && !options.portableRead) {
    throw new PortableShadowCompatibilityError(
      'invalid_configuration',
      'shadow_compare requires a portableRead function',
    )
  }

  const response = await options.legacyRead()
  let legacyRecords: unknown[]
  try {
    legacyRecords = options.normalizeLegacy(response)
    if (!Array.isArray(legacyRecords)) {
      throw new Error('normalizeLegacy did not return an array')
    }
  } catch (error) {
    throw new PortableShadowCompatibilityError(
      'legacy_normalization_failure',
      error instanceof Error ? error.message : String(error),
    )
  }

  const authority: LegacyReaderAuthorityV1 = {
    schemaVersion: 1,
    mode: 'legacy',
    sourceId: legacySourceId,
  }

  if (options.mode === 'legacy_only') {
    return {
      schemaVersion: 1,
      authority,
      response,
      shadowEvidence: null,
    }
  }

  const legacyDigest = await digestCanonical(legacyRecords)
  if (legacyRecords.length > maxRecords) {
    return {
      schemaVersion: 1,
      authority,
      response,
      shadowEvidence: {
        schemaVersion: 1,
        mode: 'shadow_compare',
        status: 'skipped_limit',
        legacySourceId,
        portableSourceId: null,
        fence: null,
        legacyCount: legacyRecords.length,
        portableCount: null,
        legacyDigest,
        portableDigest: null,
        firstMismatchIndex: null,
        errorCode: null,
        errorMessage: null,
      },
    }
  }

  let portable: PortableShadowSnapshotV1
  try {
    portable = await options.portableRead!()
  } catch (error) {
    const classified = classifyPortableError(error)
    return {
      schemaVersion: 1,
      authority,
      response,
      shadowEvidence: {
        schemaVersion: 1,
        mode: 'shadow_compare',
        status: 'portable_error',
        legacySourceId,
        portableSourceId: null,
        fence: null,
        legacyCount: legacyRecords.length,
        portableCount: null,
        legacyDigest,
        portableDigest: null,
        firstMismatchIndex: null,
        errorCode: classified.code,
        errorMessage: classified.message,
      },
    }
  }

  if (portable.records.length > maxRecords) {
    return {
      schemaVersion: 1,
      authority,
      response,
      shadowEvidence: {
        schemaVersion: 1,
        mode: 'shadow_compare',
        status: 'skipped_limit',
        legacySourceId,
        portableSourceId: portable.source.sourceId,
        fence: portable.fence,
        legacyCount: legacyRecords.length,
        portableCount: portable.records.length,
        legacyDigest,
        portableDigest: null,
        firstMismatchIndex: null,
        errorCode: null,
        errorMessage: null,
      },
    }
  }

  const portableDigest = await digestCanonical(portable.records)
  const mismatch = firstMismatch(legacyRecords, portable.records)
  return {
    schemaVersion: 1,
    authority,
    response,
    shadowEvidence: {
      schemaVersion: 1,
      mode: 'shadow_compare',
      status: mismatch === null ? 'match' : 'mismatch',
      legacySourceId,
      portableSourceId: portable.source.sourceId,
      fence: portable.fence,
      legacyCount: legacyRecords.length,
      portableCount: portable.records.length,
      legacyDigest,
      portableDigest,
      firstMismatchIndex: mismatch,
      errorCode: null,
      errorMessage: null,
    },
  }
}
