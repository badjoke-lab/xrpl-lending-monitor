import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { BaseOverlayListOptions } from './base-overlay-current-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'

export interface ThreeLayerCursorState {
  v: 1
  snapshot: string
  kind: ReadModelKind
  direction: 'asc' | 'desc'
  scope: string
  canonicalCursor: string | null
  canonicalOffset: number
  canonicalDone: boolean
  fastAfter: string | null
  fastOffset: number
  fastDone: boolean
  fastToken: string | null
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function initialCursor(options: {
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
  fastToken: string | null
}): ThreeLayerCursorState {
  return {
    v: 1,
    snapshot: options.snapshot.id,
    kind: options.kind,
    direction: options.list.direction,
    scope: options.list.scope,
    canonicalCursor: null,
    canonicalOffset: 0,
    canonicalDone: false,
    fastAfter: null,
    fastOffset: 0,
    fastDone: options.fastToken === null,
    fastToken: options.fastToken,
  }
}

export function encodeThreeLayerCursor(cursor: ThreeLayerCursorState): string {
  return encodeBase64Url(JSON.stringify(cursor))
}

export function readThreeLayerCursor(options: {
  value: string | undefined
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
  fastToken: string | null
}): ThreeLayerCursorState {
  if (!options.value) return initialCursor(options)
  try {
    const cursor = JSON.parse(decodeBase64Url(options.value)) as Partial<ThreeLayerCursorState>
    if (
      cursor.v !== 1
      || cursor.snapshot !== options.snapshot.id
      || cursor.kind !== options.kind
      || cursor.direction !== options.list.direction
      || cursor.scope !== options.list.scope
      || (cursor.canonicalCursor !== null && typeof cursor.canonicalCursor !== 'string')
      || !Number.isSafeInteger(cursor.canonicalOffset)
      || Number(cursor.canonicalOffset) < 0
      || typeof cursor.canonicalDone !== 'boolean'
      || (cursor.fastAfter !== null && typeof cursor.fastAfter !== 'string')
      || !Number.isSafeInteger(cursor.fastOffset)
      || Number(cursor.fastOffset) < 0
      || typeof cursor.fastDone !== 'boolean'
      || (cursor.fastToken !== null && typeof cursor.fastToken !== 'string')
    ) throw new Error('invalid')
    if (cursor.fastToken !== null && cursor.fastToken !== options.fastToken) {
      throw new CurrentStateObjectReadError(
        'manifest_integrity_error',
        'fast-lane read context changed during pagination',
      )
    }
    return cursor as ThreeLayerCursorState
  } catch (error) {
    if (error instanceof CurrentStateObjectReadError) throw error
    return {
      ...initialCursor({ ...options, fastToken: null }),
      canonicalCursor: options.value,
      fastDone: true,
    }
  }
}
