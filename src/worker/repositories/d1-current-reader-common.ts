import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import { CurrentStateObjectReadError } from './current-state-object-reader'

interface CursorPayload {
  version: 1
  snapshotId: string
  lastObjectId: string
  sort: 'id_asc' | 'id_desc'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function encodeD1Cursor(cursor: CursorPayload): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeD1Cursor(value: string): CursorPayload {
  try {
    const padded = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(atob(padded))
    if (!isRecord(parsed)) throw new Error('cursor must be an object')
    if (parsed.version !== 1) throw new Error('cursor version is unsupported')
    if (typeof parsed.snapshotId !== 'string' || parsed.snapshotId.length === 0) {
      throw new Error('cursor snapshotId is invalid')
    }
    if (typeof parsed.lastObjectId !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(parsed.lastObjectId)) {
      throw new Error('cursor lastObjectId is invalid')
    }
    if (parsed.sort !== 'id_asc' && parsed.sort !== 'id_desc') {
      throw new Error('cursor sort is invalid')
    }
    return {
      version: 1,
      snapshotId: parsed.snapshotId,
      lastObjectId: parsed.lastObjectId.toUpperCase(),
      sort: parsed.sort,
    }
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'invalid_cursor',
      error instanceof Error ? error.message : 'cursor is invalid',
    )
  }
}

function parseProjection<T>(projectionJson: string, rawJson: string): T {
  try {
    const projection = JSON.parse(projectionJson) as T
    const raw = JSON.parse(rawJson) as Record<string, unknown>
    if (!isRecord(projection) || !isRecord(raw)) throw new Error('stored projection must be an object')
    return { ...projection, raw } as T
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'manifest_integrity_error',
      error instanceof Error ? error.message : 'stored projection is invalid',
    )
  }
}

export function parseVaultProjection(projectionJson: string, rawJson: string): VaultCurrentProjection {
  return parseProjection<VaultCurrentProjection>(projectionJson, rawJson)
}

export function parseLoanBrokerProjection(
  projectionJson: string,
  rawJson: string,
): LoanBrokerCurrentProjection {
  return parseProjection<LoanBrokerCurrentProjection>(projectionJson, rawJson)
}

export function parseLoanProjection(projectionJson: string, rawJson: string): LoanCurrentProjection {
  return parseProjection<LoanCurrentProjection>(projectionJson, rawJson)
}
