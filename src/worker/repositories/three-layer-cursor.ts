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

interface CompactCursor {
  v: 1
  s: string
  k: ReadModelKind
  d: 'a' | 'z'
  q: string
  c: string | null
  o: number
  x: boolean
  f: string | null
  p: number
  y: boolean
  t: string | null
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeText(value: string): string {
  return encodeBytes(new TextEncoder().encode(value))
}

function decodeText(value: string): string {
  return new TextDecoder().decode(decodeBytes(value))
}

function hexToText(value: string): string {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function textToHex(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

function compactCanonicalCursor(value: string | null): string | null {
  if (value === null) return null
  if (value.length % 2 === 0 && /^[a-f0-9]+$/i.test(value)) {
    try {
      return `j${hexToText(value)}`
    } catch {
      // Preserve unusual non-UTF-8 cursors through the generic representation.
    }
  }
  return `u${value}`
}

function expandCanonicalCursor(value: string | null): string | null {
  if (value === null) return null
  if (value.startsWith('j')) return textToHex(value.slice(1))
  if (value.startsWith('u')) return value.slice(1)
  throw new Error('invalid canonical cursor encoding')
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
  const compact: CompactCursor = {
    v: 1,
    s: cursor.snapshot,
    k: cursor.kind,
    d: cursor.direction === 'asc' ? 'a' : 'z',
    q: cursor.scope,
    c: compactCanonicalCursor(cursor.canonicalCursor),
    o: cursor.canonicalOffset,
    x: cursor.canonicalDone,
    f: cursor.fastAfter,
    p: cursor.fastOffset,
    y: cursor.fastDone,
    t: cursor.fastToken,
  }
  return encodeText(JSON.stringify(compact))
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
    const compact = JSON.parse(decodeText(options.value)) as Partial<CompactCursor>
    if (
      compact.v !== 1
      || compact.s !== options.snapshot.id
      || compact.k !== options.kind
      || compact.d !== (options.list.direction === 'asc' ? 'a' : 'z')
      || compact.q !== options.list.scope
      || (compact.c !== null && typeof compact.c !== 'string')
      || !Number.isSafeInteger(compact.o)
      || Number(compact.o) < 0
      || typeof compact.x !== 'boolean'
      || (compact.f !== null && typeof compact.f !== 'string')
      || !Number.isSafeInteger(compact.p)
      || Number(compact.p) < 0
      || typeof compact.y !== 'boolean'
      || (compact.t !== null && typeof compact.t !== 'string')
    ) throw new Error('invalid')
    if (compact.t !== null && compact.t !== options.fastToken) {
      throw new CurrentStateObjectReadError(
        'manifest_integrity_error',
        'fast-lane read context changed during pagination',
      )
    }
    return {
      v: 1,
      snapshot: compact.s,
      kind: compact.k,
      direction: compact.d === 'a' ? 'asc' : 'desc',
      scope: compact.q,
      canonicalCursor: expandCanonicalCursor(compact.c),
      canonicalOffset: compact.o,
      canonicalDone: compact.x,
      fastAfter: compact.f,
      fastOffset: compact.p,
      fastDone: compact.y,
      fastToken: compact.t,
    }
  } catch (error) {
    if (error instanceof CurrentStateObjectReadError) throw error
    return {
      ...initialCursor({ ...options, fastToken: null }),
      canonicalCursor: options.value,
      fastDone: true,
    }
  }
}
